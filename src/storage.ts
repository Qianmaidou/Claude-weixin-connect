/**
 * Lightweight persistence layer — replaces OpenClaw's account store,
 * sync buffer, context token, and session management.
 *
 * Directory structure:
 *   {dataDir}/
 *     accounts.json                          # Account index
 *     accounts/{accountId}.json              # Per-account credentials
 *     accounts/{accountId}.sync.json         # get_updates_buf cursor
 *     accounts/{accountId}.context-tokens.json # userId -> contextToken
 *     conversations/{accountId}/{userId}.json  # Conversation history
 *     tmp/                                     # Temp media files
 */
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveDataDir(): string {
  const cfg = getConfig();
  return path.resolve(cfg.weixin.dataDir);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Normalize account ID for filesystem safety: replace '@' with '-'. */
export function normalizeAccountId(raw: string): string {
  return raw.replace(/@/g, "-");
}

function jsonRead<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    }
  } catch {
    // Corrupt file; fall through to fallback.
  }
  return fallback;
}

function jsonWrite(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Account types
// ---------------------------------------------------------------------------

export interface StoredAccount {
  accountId: string;
  token: string;
  baseUrl: string;
  cdnBaseUrl: string;
  userId: string;
  savedAt: string;
}

// ---------------------------------------------------------------------------
// Account index
// ---------------------------------------------------------------------------

function accountsIndexPath(): string {
  return path.join(resolveDataDir(), "accounts.json");
}

function loadAccountIndex(): string[] {
  return jsonRead<string[]>(accountsIndexPath(), []);
}

function saveAccountIndex(ids: string[]): void {
  jsonWrite(accountsIndexPath(), ids);
}

// ---------------------------------------------------------------------------
// Account CRUD
// ---------------------------------------------------------------------------

function accountFilePath(accountId: string): string {
  return path.join(resolveDataDir(), "accounts", `${normalizeAccountId(accountId)}.json`);
}

export function loadAccount(accountId: string): StoredAccount | null {
  return jsonRead<StoredAccount | null>(accountFilePath(accountId), null);
}

export function saveAccount(account: StoredAccount): void {
  const normalized = normalizeAccountId(account.accountId);
  // Update index
  const index = loadAccountIndex();
  if (!index.includes(normalized)) {
    index.push(normalized);
    saveAccountIndex(index);
  }
  // Save credential file
  jsonWrite(accountFilePath(account.accountId), account);
}

export function listAccountIds(): string[] {
  return loadAccountIndex();
}

export function removeAccount(accountId: string): void {
  const normalized = normalizeAccountId(accountId);
  const filePath = accountFilePath(accountId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  // Remove from index
  const index = loadAccountIndex().filter((id) => id !== normalized);
  saveAccountIndex(index);
}

// ---------------------------------------------------------------------------
// Sync buffer (get_updates_buf cursor)
// ---------------------------------------------------------------------------

function syncBufPath(accountId: string): string {
  return path.join(
    resolveDataDir(),
    "accounts",
    `${normalizeAccountId(accountId)}.sync.json`,
  );
}

export function loadSyncBuf(accountId: string): string {
  const data = jsonRead<{ buf: string }>(syncBufPath(accountId), { buf: "" });
  return data.buf;
}

export function saveSyncBuf(accountId: string, buf: string): void {
  jsonWrite(syncBufPath(accountId), { buf, updatedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Context tokens (userId -> contextToken)
// ---------------------------------------------------------------------------

function contextTokensPath(accountId: string): string {
  return path.join(
    resolveDataDir(),
    "accounts",
    `${normalizeAccountId(accountId)}.context-tokens.json`,
  );
}

export function getContextToken(accountId: string, userId: string): string | undefined {
  const map = jsonRead<Record<string, string>>(contextTokensPath(accountId), {});
  return map[userId];
}

export function setContextToken(accountId: string, userId: string, token: string): void {
  const map = jsonRead<Record<string, string>>(contextTokensPath(accountId), {});
  map[userId] = token;
  jsonWrite(contextTokensPath(accountId), map);
}

// ---------------------------------------------------------------------------
// Conversation history
// ---------------------------------------------------------------------------

export interface ConversationEntry {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

function conversationPath(accountId: string, userId: string): string {
  return path.join(
    resolveDataDir(),
    "conversations",
    normalizeAccountId(accountId),
    `${normalizeAccountId(userId)}.json`,
  );
}

export function loadConversation(
  accountId: string,
  userId: string,
): ConversationEntry[] {
  return jsonRead<ConversationEntry[]>(conversationPath(accountId, userId), []);
}

export function saveConversation(
  accountId: string,
  userId: string,
  entries: ConversationEntry[],
): void {
  jsonWrite(conversationPath(accountId, userId), entries);
}

/**
 * Prune conversation to keep at most `maxMessages` recent entries.
 * Returns the pruned array.
 */
export function pruneConversation(
  entries: ConversationEntry[],
  maxMessages: number,
): ConversationEntry[] {
  if (entries.length <= maxMessages) return entries;
  return entries.slice(entries.length - maxMessages);
}

/**
 * Estimate token count for a conversation entry (very rough: ~4 chars per token).
 */
export function estimateTokens(entries: ConversationEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    total += Math.ceil(entry.content.length / 4);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Temp directory for media
// ---------------------------------------------------------------------------

export function getTempDir(): string {
  const dir = path.join(resolveDataDir(), "tmp");
  ensureDir(dir);
  return dir;
}
