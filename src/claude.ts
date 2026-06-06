/**
 * Unified AI streaming wrapper — supports both Anthropic Claude and
 * OpenAI-compatible APIs (DeepSeek, OpenAI, etc.).
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getConfig } from "./config.js";
import type { AIConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Claude-compatible message (text or text+image). */
export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | Anthropic.Messages.ContentBlockParam[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAIConfig(): AIConfig {
  return getConfig().ai;
}

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

function isRetryableError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 429) return true;
    if (err.status && err.status >= 500) return true;
    return false;
  }
  if (err instanceof OpenAI.APIError) {
    if (err.status === 429) return true;
    if (err.status && err.status >= 500) return true;
    return false;
  }
  return true; // network errors
}

// ---------------------------------------------------------------------------
// Anthropic streaming
// ---------------------------------------------------------------------------

async function* streamAnthropic(
  cfg: AIConfig,
  messages: ClaudeMessage[],
): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey: cfg.apiKey });

  const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const stream = client.messages.stream({
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    temperature: cfg.temperature,
    messages: anthropicMessages,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible streaming (DeepSeek, OpenAI, etc.)
// ---------------------------------------------------------------------------

async function* streamOpenAI(
  cfg: AIConfig,
  messages: ClaudeMessage[],
): AsyncGenerator<string> {
  const actualBaseURL = cfg.baseURL || "https://api.openai.com/v1";
  console.log(`[AI] 🔗 调用 DeepSeek API: baseURL=${actualBaseURL}, model=${cfg.model}, key=${cfg.apiKey.slice(0, 8)}...`);

  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: actualBaseURL,
  });

  // DeepSeek API doesn't support image_url content blocks (text only).
  // Strip image blocks and replace with a text note to avoid 400 errors.
  const hasImages = messages.some(
    (m) => Array.isArray(m.content) && m.content.some((b) => (b as { type: string }).type === "image"),
  );
  if (hasImages) {
    console.log("[AI] ⚠️ DeepSeek 不支持图片，转换为文字提示");
    messages = messages.map((m) => {
      if (Array.isArray(m.content)) {
        const contentArr = m.content as { type: string; text?: string }[];
        const textBlocks = contentArr.filter((b) => b.type === "text");
        const imageCount = contentArr.filter((b) => b.type === "image").length;
        const text = textBlocks.map((b) => b.text ?? "").join("\n");
        return {
          role: m.role,
          content: text || `[用户发送了 ${imageCount} 张图片，当前模型不支持图片识别]`,
        };
      }
      return m;
    });
  }

  // Convert Anthropic-format messages to OpenAI format
  const openaiMessages = messages.map((m) => {
    const content = convertContentToOpenAI(m.content);
    if (m.role === "assistant") {
      return { role: "assistant" as const, content: content as string };
    }
    return { role: "user" as const, content };
  });

  const stream = await client.chat.completions.create({
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    temperature: cfg.temperature,
    messages: openaiMessages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    stream: true,
  });

  console.log(`[AI] 📡 流式响应开始...`);
  let chunkCount = 0;
  let contentChars = 0;
  try {
    for await (const chunk of stream) {
      chunkCount++;
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        contentChars += delta.length;
        if (chunkCount <= 3) console.log(`[AI] 📝 chunk #${chunkCount}: "${delta.slice(0, 60)}"`);
        yield delta;
      }
    }
    console.log(`[AI] ✅ 流式完成: ${chunkCount} chunks, ${contentChars} chars`);
  } catch (err) {
    console.error(`[AI] ❌ 流式中断 (chunk ${chunkCount}): ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/**
 * Convert Anthropic-format content to OpenAI format.
 * Anthropic: string | [{type:"text", text},{type:"image", source:{type:"base64",...}}]
 * OpenAI:   string | [{type:"text", text},{type:"image_url", image_url:{url:"data:..."}}]
 */
function convertContentToOpenAI(
  content: string | Anthropic.Messages.ContentBlockParam[],
): string | OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  if (typeof content === "string") return content;

  return content
    .map((block): OpenAI.Chat.Completions.ChatCompletionContentPart | null => {
      if (block.type === "text" && "text" in block) {
        return { type: "text", text: block.text };
      }
      if (block.type === "image" && "source" in block) {
        const src = block.source as { type: string; media_type: string; data: string };
        return {
          type: "image_url",
          image_url: {
            url: `data:${src.media_type};base64,${src.data}`,
          },
        };
      }
      return null;
    })
    .filter(Boolean) as OpenAI.Chat.Completions.ChatCompletionContentPart[];
}

// ---------------------------------------------------------------------------
// Unified streaming interface
// ---------------------------------------------------------------------------

/**
 * Stream an AI response as an async generator of text delta strings.
 * Automatically selects Anthropic or OpenAI-compatible backend based on config.
 */
export async function* streamClaudeResponse(
  opts: {
    systemPrompt: string;
    messages: ClaudeMessage[];
    model?: string;
  },
): AsyncGenerator<string> {
  const cfg = { ...getAIConfig() };
  if (opts.model) cfg.model = opts.model;

  const provider = cfg.provider ?? "anthropic";

  // Prepend system prompt as a user-style message for OpenAI (no system param in streaming generator)
  let messages = opts.messages;
  if (provider === "openai-compatible" && opts.systemPrompt) {
    messages = [
      { role: "user", content: opts.systemPrompt },
      { role: "assistant", content: "好的，我会按照以上指示回复。" },
      ...messages,
    ];
  }

  let lastError: unknown;
  let delayMs = INITIAL_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (provider === "openai-compatible") {
        const stream = streamOpenAI(cfg, messages);
        for await (const delta of stream) yield delta;
      } else {
        const stream = streamAnthropic(cfg, messages);
        for await (const delta of stream) yield delta;
      }
      return; // Success
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AI] ❌ 非可重试错误: ${msg}`);
        if (err instanceof Error && err.stack) {
          console.error(err.stack.split("\n").slice(0, 4).join("\n"));
        }
        throw err;
      }

      if (attempt < MAX_RETRIES) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[AI] ⚠️ 第 ${attempt}/${MAX_RETRIES} 次尝试失败 (${delayMs}ms 后重试): ${msg}`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        delayMs *= 2;
      }
    }
  }
  console.error(`[AI] ❌ ${MAX_RETRIES} 次重试全部失败`);
  throw lastError;
}

/**
 * Simple non-streaming call (for slash commands).
 */
export async function claudeComplete(
  systemPrompt: string,
  userMessage: string,
  opts?: { model?: string },
): Promise<string> {
  const cfg = getAIConfig();
  const model = opts?.model ?? cfg.model;

  if (cfg.provider === "openai-compatible") {
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL || undefined,
    });
    const response = await client.chat.completions.create({
      model,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });
    return response.choices[0]?.message?.content ?? "";
  }

  // Anthropic
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: cfg.maxTokens,
    temperature: cfg.temperature,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text ?? "";
}

/** Reset cached clients (e.g. after config changes). */
export function resetClaudeClient(): void {
  // No-op: clients are created per-request now since config can change
}
