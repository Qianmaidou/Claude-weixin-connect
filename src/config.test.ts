import { describe, it, expect } from "vitest";
import { BridgeConfigSchema, DEFAULT_CONFIG } from "./config.js";

describe("BridgeConfigSchema", () => {
  it("accepts minimal config and fills defaults", () => {
    const result = BridgeConfigSchema.safeParse({
      ai: { apiKey: "sk-test" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ai.apiKey).toBe("sk-test");
      expect(result.data.ai.model).toBe("claude-sonnet-4-20250514");
      expect(result.data.ai.provider).toBe("anthropic");
      expect(result.data.weixin.dataDir).toBe("./data");
      expect(result.data.conversation.maxHistoryMessages).toBe(20);
      expect(result.data.allowedUsers).toEqual([]);
    }
  });

  it("accepts empty config (ai is optional, fallback to defaults)", () => {
    const result = BridgeConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects empty apiKey", () => {
    const result = BridgeConfigSchema.safeParse({
      ai: { apiKey: "" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts openai-compatible config", () => {
    const result = BridgeConfigSchema.safeParse({
      ai: {
        provider: "openai-compatible",
        apiKey: "sk-deepseek-test",
        baseURL: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        maxTokens: 8192,
        temperature: 0.5,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ai.provider).toBe("openai-compatible");
      expect(result.data.ai.baseURL).toBe("https://api.deepseek.com/v1");
      expect(result.data.ai.model).toBe("deepseek-chat");
    }
  });

  it("accepts full config (anthropic)", () => {
    const result = BridgeConfigSchema.safeParse({
      ai: {
        provider: "anthropic",
        apiKey: "sk-ant-test",
        model: "claude-opus-4-20250514",
        maxTokens: 8192,
        temperature: 0.5,
      },
      weixin: {
        dataDir: "/custom/data",
        botAgent: "MyBot/2.0",
      },
      conversation: {
        maxHistoryMessages: 50,
        maxContextTokens: 100000,
      },
      allowedUsers: ["user1", "user2"],
      systemPromptFile: "custom-prompt.md",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ai.model).toBe("claude-opus-4-20250514");
      expect(result.data.ai.provider).toBe("anthropic");
      expect(result.data.weixin.dataDir).toBe("/custom/data");
      expect(result.data.conversation.maxHistoryMessages).toBe(50);
    }
  });

  it("DEFAULT_CONFIG is valid", () => {
    const result = BridgeConfigSchema.safeParse({
      ...DEFAULT_CONFIG,
      ai: { ...DEFAULT_CONFIG.ai, apiKey: "sk-test" },
    });
    expect(result.success).toBe(true);
  });
});
