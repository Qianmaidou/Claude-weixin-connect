/**
 * Claude API streaming wrapper — thin layer over @anthropic-ai/sdk.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "./config.js";
import type { ConversationEntry } from "./storage.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudeStreamOpts {
  /** System prompt (placed in the system parameter, not as a user message). */
  systemPrompt: string;
  /** Conversation history (user/assistant messages). */
  messages: ConversationEntry[];
  /** Override the model from config (e.g. per-user setting). */
  model?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const cfg = getConfig();
    if (!cfg.claude.apiKey) {
      throw new Error(
        "Claude API key not configured. Set CLAUDE_API_KEY environment variable or claude.apiKey in config.json",
      );
    }
    _client = new Anthropic({ apiKey: cfg.claude.apiKey });
  }
  return _client;
}

/** Reset the client (e.g. after config changes). */
export function resetClaudeClient(): void {
  _client = null;
}

// ---------------------------------------------------------------------------
// Streaming response generator
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Check if an error is retryable (rate limits, server errors, network issues).
 * Non-retryable: auth errors (401, 403), bad requests (400), content policy violations.
 */
function isRetryableError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    // 429 rate limit, 5xx server errors are retryable
    if (err.status === 429) return true;
    if (err.status && err.status >= 500) return true;
    // 400-level errors except 429 are NOT retryable
    return false;
  }
  // Network errors (fetch failures, timeouts) are retryable
  return true;
}

/**
 * Stream a Claude response as an async generator of text delta strings.
 *
 * On transient errors (rate limits, 5xx, network), retries up to MAX_RETRIES
 * times with exponential backoff. Non-retryable errors (401, 403, 400) throw
 * immediately.
 */
export async function* streamClaudeResponse(
  opts: ClaudeStreamOpts,
): AsyncGenerator<string, void, unknown> {
  const client = getClient();
  const cfg = getConfig();
  const model = opts.model ?? cfg.claude.model;

  // Build the messages array for the Claude API
  const messages: Anthropic.MessageParam[] = opts.messages.map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));

  let lastError: unknown;
  let delayMs = INITIAL_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const stream = client.messages.stream({
        model,
        max_tokens: cfg.claude.maxTokens,
        temperature: cfg.claude.temperature,
        system: opts.systemPrompt,
        messages,
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield event.delta.text;
        }
      }
      return; // Success
    } catch (err) {
      lastError = err;

      if (!isRetryableError(err)) {
        throw err; // Don't retry auth/bad request errors
      }

      if (attempt < MAX_RETRIES) {
        const msg =
          err instanceof Error ? err.message : String(err);
        console.error(
          `Claude API attempt ${attempt}/${MAX_RETRIES} failed (retrying in ${delayMs}ms): ${msg}`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        delayMs *= 2; // Exponential backoff
      }
    }
  }

  throw lastError;
}

/**
 * Simple non-streaming call for quick completions (e.g. slash command responses).
 */
export async function claudeComplete(
  systemPrompt: string,
  userMessage: string,
  opts?: { model?: string },
): Promise<string> {
  const client = getClient();
  const cfg = getConfig();

  const response = await client.messages.create({
    model: opts?.model ?? cfg.claude.model,
    max_tokens: cfg.claude.maxTokens,
    temperature: cfg.claude.temperature,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text ?? "";
}
