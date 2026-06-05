import { describe, it, expect, beforeEach } from "vitest";
import { BridgeConfigSchema, DEFAULT_CONFIG } from "./config.js";

describe("BridgeConfigSchema", () => {
  it("accepts minimal config and fills defaults", () => {
    const result = BridgeConfigSchema.safeParse({
      claude: { apiKey: "sk-test" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.claude.apiKey).toBe("sk-test");
      expect(result.data.claude.model).toBe("claude-sonnet-4-20250514");
      expect(result.data.weixin.dataDir).toBe("./data");
      expect(result.data.conversation.maxHistoryMessages).toBe(20);
      expect(result.data.allowedUsers).toEqual([]);
    }
  });

  it("rejects missing claude config", () => {
    const result = BridgeConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const result = BridgeConfigSchema.safeParse({
      claude: { apiKey: "" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts full config", () => {
    const result = BridgeConfigSchema.safeParse({
      claude: {
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
      expect(result.data.claude.model).toBe("claude-opus-4-20250514");
      expect(result.data.weixin.dataDir).toBe("/custom/data");
      expect(result.data.conversation.maxHistoryMessages).toBe(50);
    }
  });

  it("DEFAULT_CONFIG is valid", () => {
    // DEFAULT_CONFIG with an empty apiKey won't validate, but that's expected
    // at file-load time (before env var resolution).
    const result = BridgeConfigSchema.safeParse({
      ...DEFAULT_CONFIG,
      claude: { ...DEFAULT_CONFIG.claude, apiKey: "sk-test" },
    });
    expect(result.success).toBe(true);
  });
});
