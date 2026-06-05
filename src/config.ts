import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ClaudeConfigSchema = z.object({
  /** Anthropic API key. Supports ${ENV_VAR} substitution. */
  apiKey: z.string().min(1),
  /** Claude model ID (e.g. claude-sonnet-4-20250514). */
  model: z.string().default("claude-sonnet-4-20250514"),
  /** Maximum tokens in Claude response. */
  maxTokens: z.number().int().positive().default(4096),
  /** Temperature (0-1). */
  temperature: z.number().min(0).max(1).default(0.7),
});

const WeixinConfigSchema = z.object({
  /** Data directory for accounts, conversations, logs. */
  dataDir: z.string().default("./data"),
  /** Bot agent string (like HTTP User-Agent). */
  botAgent: z.string().default("ClaudeWeixinConnect/1.0"),
  /** iLink App ID. */
  ilinkAppId: z.string().default("bot"),
  /** Channel version string. */
  channelVersion: z.string().default("1.0.0"),
  /** Default CDN base URL. */
  defaultCdnBaseUrl: z.string().default("https://novac2c.cdn.weixin.qq.com/c2c"),
  /** Default API base URL. */
  defaultApiBaseUrl: z.string().default("https://ilinkai.weixin.qq.com"),
});

const ConversationConfigSchema = z.object({
  /** Maximum number of messages in conversation history. */
  maxHistoryMessages: z.number().int().positive().default(20),
  /** Estimated max context tokens before pruning old messages. */
  maxContextTokens: z.number().int().positive().default(50000),
});

export const BridgeConfigSchema = z.object({
  claude: ClaudeConfigSchema,
  weixin: WeixinConfigSchema.default({}),
  conversation: ConversationConfigSchema.default({}),
  /** List of WeChat user IDs allowed to interact. Empty = allow all. */
  allowedUsers: z.array(z.string()).default([]),
  /** Path to system prompt file (relative to dataDir or absolute). */
  systemPromptFile: z.string().default("system-prompt.md"),
});

export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;
export type ClaudeConfig = z.infer<typeof ClaudeConfigSchema>;
export type WeixinConfig = z.infer<typeof WeixinConfigSchema>;
export type ConversationConfig = z.infer<typeof ConversationConfigSchema>;

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: BridgeConfig = {
  claude: {
    apiKey: "",
    model: "claude-sonnet-4-20250514",
    maxTokens: 4096,
    temperature: 0.7,
  },
  weixin: {
    dataDir: "./data",
    botAgent: "ClaudeWeixinConnect/1.0",
    ilinkAppId: "bot",
    channelVersion: "1.0.0",
    defaultCdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
    defaultApiBaseUrl: "https://ilinkai.weixin.qq.com",
  },
  conversation: {
    maxHistoryMessages: 20,
    maxContextTokens: 50000,
  },
  allowedUsers: [],
  systemPromptFile: "system-prompt.md",
};

// ---------------------------------------------------------------------------
// Env var substitution
// ---------------------------------------------------------------------------

/**
 * Replace ${ENV_VAR} patterns in a string with their environment values.
 * Unknown vars are replaced with empty string.
 */
function resolveEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    return process.env[name] ?? "";
  });
}

/** Deep-resolve env vars in all string values of an object. */
function resolveEnvVarsDeep(obj: unknown): unknown {
  if (typeof obj === "string") return resolveEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(resolveEnvVarsDeep);
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveEnvVarsDeep(value);
    }
    return result;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

let _config: BridgeConfig | null = null;

/**
 * Load and validate the bridge config from a JSON file.
 * Falls back to defaults for missing fields.
 * Supports ${ENV_VAR} substitution in string values.
 */
export function loadConfig(configPath?: string): BridgeConfig {
  const resolvedPath = configPath ?? resolveDefaultConfigPath();

  let raw: unknown = {};
  if (fs.existsSync(resolvedPath)) {
    try {
      const text = fs.readFileSync(resolvedPath, "utf-8");
      raw = JSON.parse(text);
    } catch (err) {
      console.error(`Error reading config from ${resolvedPath}: ${String(err)}`);
      console.error("Using default configuration.");
    }
  }

  // Resolve env vars before validation
  raw = resolveEnvVarsDeep(raw);

  const result = BridgeConfigSchema.safeParse(raw);
  if (!result.success) {
    console.error("Config validation errors:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    console.error("Using default configuration.");
    _config = { ...DEFAULT_CONFIG };
    return _config;
  }

  _config = result.data;
  return _config;
}

/** Get the loaded config. Throws if not yet loaded. */
export function getConfig(): BridgeConfig {
  if (!_config) {
    // Auto-load with defaults
    _config = loadConfig();
  }
  return _config;
}

function resolveDefaultConfigPath(): string {
  const dataDir = process.env.BRIDGE_DATA_DIR ?? "./data";
  return path.resolve(dataDir, "config.json");
}
