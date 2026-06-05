/**
 * Main bot loop — long-poll WeChat messages → Claude API → send reply.
 *
 * Replaces monitor.ts + process-message.ts from openclaw-weixin,
 * substituting Claude API for the OpenClaw AI framework.
 */
import fs from "node:fs";
import path from "node:path";

import { getUpdates, notifyStart, notifyStop, sendTyping } from "./weixin/api/api.js";
import { WeixinConfigManager } from "./weixin/api/config-cache.js";
import { pauseSession, assertSessionActive, SESSION_EXPIRED_ERRCODE } from "./weixin/api/session-guard.js";
import { sendMessageWeixin, StreamingMarkdownFilter } from "./weixin/messaging/send.js";
import { logger } from "./weixin/util/logger.js";
import { MessageItemType, MessageState, TypingStatus } from "./weixin/api/types.js";
import { streamClaudeResponse } from "./claude.js";
import { getConfig } from "./config.js";
import {
  loadSyncBuf,
  saveSyncBuf,
  getContextToken,
  setContextToken,
  loadConversation,
  saveConversation,
  pruneConversation,
  estimateTokens,
  type ConversationEntry,
  type StoredAccount,
} from "./storage.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BotState {
  running: boolean;
  abortController: AbortController;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[bot]";

/** Extract text body from a WeChat message's item_list. */
function extractText(msg: { item_list?: { type?: number; text_item?: { text?: string } }[] }): string {
  if (!msg.item_list) return "";
  const texts = msg.item_list
    .filter((item) => item.type === MessageItemType.TEXT)
    .map((item) => item.text_item?.text ?? "")
    .filter(Boolean);
  return texts.join("\n");
}

/** Load system prompt from file or return default. */
function loadSystemPromptSync(): string {
  const cfg = getConfig();
  const promptFile = cfg.systemPromptFile;
  if (!promptFile) return DEFAULT_SYSTEM_PROMPT;

  // Try absolute path first, then relative to dataDir
  const candidates = [
    promptFile,
    path.resolve(cfg.weixin.dataDir, promptFile),
  ];

  for (const fp of candidates) {
    try {
      if (fs.existsSync(fp)) {
        return fs.readFileSync(fp, "utf-8").trim();
      }
    } catch {
      // try next
    }
  }

  return DEFAULT_SYSTEM_PROMPT;
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant connected to WeChat. You are communicating with a user through WeChat messages.

Guidelines:
- Be concise and friendly — WeChat is a casual messaging platform.
- Use plain text (avoid excessive markdown; bold and code blocks are fine).
- If you receive an image, describe what you see.
- If you receive a voice message, respond to the transcribed text.
- If asked to do something you cannot do, explain politely.
- You can read and write Chinese (Simplified).`;

// ---------------------------------------------------------------------------
// Typing indicator
// ---------------------------------------------------------------------------

function startTypingIndicator(
  account: StoredAccount,
  toUserId: string,
  configManager: WeixinConfigManager,
): { stop: () => Promise<void> } {
  let running = true;
  let interval: ReturnType<typeof setInterval> | null = null;

  const sendTypingPing = async () => {
    if (!running) return;
    try {
      const cfg = await configManager.getForUser(toUserId);
      if (!cfg.typingTicket) return;
      await sendTyping({
        baseUrl: account.baseUrl,
        token: account.token,
        body: {
          ilink_user_id: toUserId,
          typing_ticket: cfg.typingTicket,
          status: TypingStatus.TYPING,
        },
      });
    } catch {
      // Best-effort
    }
  };

  // Send initial typing + start periodic keepalive
  sendTypingPing();
  interval = setInterval(sendTypingPing, 5000);

  return {
    async stop() {
      running = false;
      if (interval) clearInterval(interval);
      // Send cancel typing
      try {
        const cfg = await configManager.getForUser(toUserId);
        if (cfg.typingTicket) {
          await sendTyping({
            baseUrl: account.baseUrl,
            token: account.token,
            body: {
              ilink_user_id: toUserId,
              typing_ticket: cfg.typingTicket,
              status: TypingStatus.CANCEL,
            },
          });
        }
      } catch {
        // Best-effort
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Stream reply with chunked delivery
// ---------------------------------------------------------------------------

const STREAM_CHUNK_CHARS = 200;
const STREAM_IDLE_MS = 3000;

async function streamReply(
  account: StoredAccount,
  toUserId: string,
  contextToken: string,
  systemPrompt: string,
  conversation: ConversationEntry[],
  configManager: WeixinConfigManager,
): Promise<string> {
  const typing = startTypingIndicator(account, toUserId, configManager);
  const filter = new StreamingMarkdownFilter();

  let fullResponse = "";
  let buffer = "";
  let lastFlush = Date.now();
  let messageState: number = MessageState.GENERATING;
  const MAX_GENERATING_MESSAGES = 10;
  let generatingCount = 0;

  const flushBuffer = async (force = false) => {
    const filtered = filter.feed(buffer);
    buffer = "";
    if (!filtered && !force) return;

    const text = filtered || (force ? filter.flush() : "");
    if (!text) return;

    try {
      if (messageState === MessageState.GENERATING && generatingCount >= MAX_GENERATING_MESSAGES) {
        // Switch to FINISH to avoid too many GENERATING messages
        messageState = MessageState.FINISH;
      }

      await sendMessageWeixin({
        to: toUserId,
        text,
        opts: {
          baseUrl: account.baseUrl,
          token: account.token,
          contextToken,
        },
      });

      if (messageState === MessageState.GENERATING) {
        generatingCount++;
      }
    } catch (err) {
      logger.error(`${LOG_PREFIX} streamReply send failed: ${String(err)}`);
    }
  };

  const flushTimer = setInterval(async () => {
    if (buffer && Date.now() - lastFlush >= STREAM_IDLE_MS) {
      await flushBuffer(false);
      lastFlush = Date.now();
    }
  }, 1000);

  try {
    const stream = streamClaudeResponse({
      systemPrompt,
      messages: conversation,
    });

    for await (const delta of stream) {
      fullResponse += delta;
      buffer += delta;
      lastFlush = Date.now();

      if (buffer.length >= STREAM_CHUNK_CHARS) {
        await flushBuffer(false);
      }
    }

    // Final flush
    if (buffer) {
      const final = filter.flush();
      if (final) {
        try {
          await sendMessageWeixin({
            to: toUserId,
            text: final,
            opts: {
              baseUrl: account.baseUrl,
              token: account.token,
              contextToken,
            },
          });
        } catch (err) {
          logger.error(`${LOG_PREFIX} final flush failed: ${String(err)}`);
        }
      }
    }
  } finally {
    clearInterval(flushTimer);
    await typing.stop();
  }

  return fullResponse;
}

// ---------------------------------------------------------------------------
// Message processing
// ---------------------------------------------------------------------------

const MAX_CONSECUTIVE_FAILURES = 3;

async function processMessage(
  account: StoredAccount,
  msg: { from_user_id?: string; to_user_id?: string; item_list?: { type?: number; text_item?: { text?: string } }[]; context_token?: string },
  configManager: WeixinConfigManager,
): Promise<void> {
  const fromUserId = msg.from_user_id;
  if (!fromUserId) {
    logger.warn(`${LOG_PREFIX} message missing from_user_id, skipping`);
    return;
  }

  // Authorization check
  const cfg = getConfig();
  if (cfg.allowedUsers.length > 0 && !cfg.allowedUsers.includes(fromUserId)) {
    logger.info(`${LOG_PREFIX} user ${fromUserId} not in allowedUsers, dropping message`);
    return;
  }

  const text = extractText(msg);
  if (!text) {
    logger.debug(`${LOG_PREFIX} empty text message from ${fromUserId}, skipping`);
    return;
  }

  logger.info(`${LOG_PREFIX} processing message from ${fromUserId}: "${text.slice(0, 80)}"`);

  // Save context token for future replies
  if (msg.context_token) {
    setContextToken(account.accountId, fromUserId, msg.context_token);
  }

  // Load conversation history
  let conversation = loadConversation(account.accountId, fromUserId);

  // Append user message
  conversation.push({
    role: "user",
    content: text,
    timestamp: Date.now(),
  });

  // Load system prompt
  const systemPrompt = loadSystemPromptSync();

  // Get context token for sending
  const contextToken = getContextToken(account.accountId, fromUserId) ?? msg.context_token ?? "";

  // Stream Claude response
  let replyText = "";
  try {
    replyText = await streamReply(
      account,
      fromUserId,
      contextToken,
      systemPrompt,
      conversation,
      configManager,
    );
  } catch (err) {
    logger.error(`${LOG_PREFIX} Claude stream failed for ${fromUserId}: ${String(err)}`);
    try {
      await sendMessageWeixin({
        to: fromUserId,
        text: "抱歉，我遇到了一些问题，请稍后再试。",
        opts: {
          baseUrl: account.baseUrl,
          token: account.token,
          contextToken,
        },
      });
    } catch {
      // Best-effort error message
    }
    return;
  }

  // Append assistant response
  if (replyText) {
    conversation.push({
      role: "assistant",
      content: replyText,
      timestamp: Date.now(),
    });
  }

  // Prune and save
  conversation = pruneConversation(conversation, cfg.conversation.maxHistoryMessages);

  // Also prune by estimated token count
  while (
    estimateTokens(conversation) > cfg.conversation.maxContextTokens &&
    conversation.length > 2
  ) {
    conversation = conversation.slice(2); // Remove oldest pair
  }

  saveConversation(account.accountId, fromUserId, conversation);
}

// ---------------------------------------------------------------------------
// Main bot loop
// ---------------------------------------------------------------------------

export async function startBot(account: StoredAccount): Promise<void> {
  const state: BotState = {
    running: true,
    abortController: new AbortController(),
  };

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${LOG_PREFIX} received ${signal}, shutting down...`);
    state.running = false;
    state.abortController.abort();
    try {
      await notifyStop({
        baseUrl: account.baseUrl,
        token: account.token,
      });
      logger.info(`${LOG_PREFIX} notifyStop sent`);
    } catch (err) {
      logger.error(`${LOG_PREFIX} notifyStop failed: ${String(err)}`);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Config manager for typing tickets
  const configManager = new WeixinConfigManager(
    { baseUrl: account.baseUrl, token: account.token },
    (msg) => logger.info(msg),
  );

  // Notify server we're starting
  try {
    await notifyStart({
      baseUrl: account.baseUrl,
      token: account.token,
    });
    logger.info(`${LOG_PREFIX} notifyStart sent`);
  } catch (err) {
    logger.error(`${LOG_PREFIX} notifyStart failed: ${String(err)}`);
  }

  // Load sync buffer for getUpdates cursor
  let syncBuf = loadSyncBuf(account.accountId);

  let consecutiveFailures = 0;

  logger.info(`${LOG_PREFIX} starting long-poll loop for ${account.accountId}`);

  while (state.running) {
    try {
      // Check session guard
      try {
        assertSessionActive(account.accountId);
      } catch {
        logger.warn(`${LOG_PREFIX} session paused, waiting...`);
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }

      const resp = await getUpdates({
        get_updates_buf: syncBuf,
        baseUrl: account.baseUrl,
        token: account.token,
        abortSignal: state.abortController.signal,
      });

      // Check for session expiry
      if (resp.errcode === SESSION_EXPIRED_ERRCODE) {
        logger.warn(`${LOG_PREFIX} session expired (errcode -14), pausing...`);
        pauseSession(account.accountId);
        consecutiveFailures = 0;
        continue;
      }

      if (resp.ret !== 0 && resp.ret !== undefined) {
        logger.warn(`${LOG_PREFIX} getUpdates ret=${resp.ret} errmsg=${resp.errmsg}`);
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          logger.error(`${LOG_PREFIX} ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off`);
          await new Promise((r) => setTimeout(r, 30_000));
          consecutiveFailures = 0;
        }
        continue;
      }

      consecutiveFailures = 0;

      // Save sync buffer
      if (resp.get_updates_buf) {
        syncBuf = resp.get_updates_buf;
        saveSyncBuf(account.accountId, syncBuf);
      }

      // Process messages
      if (resp.msgs && resp.msgs.length > 0) {
        logger.info(`${LOG_PREFIX} received ${resp.msgs.length} message(s)`);
        for (const msg of resp.msgs) {
          if (!state.running) break;
          try {
            await processMessage(account, msg, configManager);
          } catch (err) {
            logger.error(`${LOG_PREFIX} processMessage error: ${String(err)}`);
          }
        }
      }
    } catch (err) {
      if (!state.running) break;
      logger.error(`${LOG_PREFIX} getUpdates error: ${String(err)}`);
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        await new Promise((r) => setTimeout(r, 30_000));
        consecutiveFailures = 0;
      }
    }
  }
}
