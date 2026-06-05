import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Use a temp data dir for tests
const testDataDir = path.join(os.tmpdir(), `claude-weixin-test-${Date.now()}`);

// Override data dir before importing storage
process.env.BRIDGE_DATA_DIR = testDataDir;

// Now import (must be after env var is set)
import {
  normalizeAccountId,
  saveAccount,
  loadAccount,
  listAccountIds,
  removeAccount,
  loadSyncBuf,
  saveSyncBuf,
  getContextToken,
  setContextToken,
  loadConversation,
  saveConversation,
  pruneConversation,
  estimateTokens,
  type StoredAccount,
} from "./storage.js";

// Pre-load config with test data dir
import { loadConfig } from "./config.js";
loadConfig();

const testAccount: StoredAccount = {
  accountId: "hex@im.bot",
  token: "test-token-12345",
  baseUrl: "https://ilinkai.weixin.qq.com",
  cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
  userId: "wx-user-abc",
  savedAt: new Date().toISOString(),
};

afterEach(() => {
  // Clean up test data
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
});

describe("normalizeAccountId", () => {
  it("replaces @ with -", () => {
    expect(normalizeAccountId("hex@im.bot")).toBe("hex-im.bot");
  });

  it("keeps already normalized ids unchanged", () => {
    expect(normalizeAccountId("hex-im.bot")).toBe("hex-im.bot");
  });
});

describe("account CRUD", () => {
  it("saves and loads an account", () => {
    saveAccount(testAccount);
    const loaded = loadAccount("hex@im.bot");
    expect(loaded).not.toBeNull();
    expect(loaded!.token).toBe("test-token-12345");
    expect(loaded!.userId).toBe("wx-user-abc");
  });

  it("lists account IDs", () => {
    saveAccount(testAccount);
    const ids = listAccountIds();
    expect(ids).toContain("hex-im.bot");
  });

  it("removes an account", () => {
    saveAccount(testAccount);
    removeAccount("hex@im.bot");
    expect(loadAccount("hex@im.bot")).toBeNull();
    expect(listAccountIds()).not.toContain("hex-im.bot");
  });

  it("returns null for missing account", () => {
    expect(loadAccount("nonexistent")).toBeNull();
  });
});

describe("sync buffer", () => {
  it("saves and loads sync buffer", () => {
    saveSyncBuf("acc1", "buffer-data-abc");
    expect(loadSyncBuf("acc1")).toBe("buffer-data-abc");
  });

  it("returns empty string for missing buffer", () => {
    expect(loadSyncBuf("never-saved")).toBe("");
  });
});

describe("context tokens", () => {
  it("sets and gets context token", () => {
    setContextToken("acc1", "user1", "ctx-token-123");
    expect(getContextToken("acc1", "user1")).toBe("ctx-token-123");
  });

  it("returns undefined for missing token", () => {
    expect(getContextToken("acc1", "unknown-user")).toBeUndefined();
  });
});

describe("conversation history", () => {
  it("saves and loads conversation", () => {
    const entries = [
      { role: "user" as const, content: "Hello", timestamp: Date.now() },
      { role: "assistant" as const, content: "Hi!", timestamp: Date.now() },
    ];
    saveConversation("acc1", "user1", entries);
    const loaded = loadConversation("acc1", "user1");
    expect(loaded).toHaveLength(2);
    expect(loaded[0].role).toBe("user");
  });

  it("returns empty array for new conversation", () => {
    expect(loadConversation("acc1", "new-user")).toEqual([]);
  });

  it("prunes old messages", () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i}`,
      timestamp: Date.now() - (25 - i) * 1000,
    }));
    const pruned = pruneConversation(entries, 20);
    expect(pruned).toHaveLength(20);
    expect(pruned[0].content).toBe("msg 5"); // oldest 5 dropped
    expect(pruned[19].content).toBe("msg 24");
  });

  it("does not prune when under limit", () => {
    const entries = [
      { role: "user" as const, content: "hi", timestamp: Date.now() },
    ];
    const pruned = pruneConversation(entries, 20);
    expect(pruned).toHaveLength(1);
  });
});

describe("estimateTokens", () => {
  it("estimates roughly 1 token per 4 chars", () => {
    const entries = [
      { role: "user" as const, content: "Hello, world!", timestamp: Date.now() },
    ];
    const tokens = estimateTokens(entries);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThanOrEqual(10); // 13 chars / 4 ≈ 4
  });
});
