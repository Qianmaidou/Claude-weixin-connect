/**
 * CLI entry point for Claude Weixin Connect.
 *
 * Commands:
 *   login                          QR code login
 *   start [--account <id>]         Start bot (default: first account)
 *   accounts                       List registered accounts
 *   logout --account <id>          Remove an account
 *   status                         Show runtime status
 */
import { loadConfig, getConfig } from "./config.js";
import { setApiBotAgent, setApiRouteTag } from "./weixin/api/api.js";
import { setLogDir } from "./weixin/util/logger.js";
import {
  startWeixinLoginWithQr,
  waitForWeixinLogin,
  displayQRCode,
} from "./weixin/auth/login-qr.js";
import { listAccountIds, loadAccount, removeAccount } from "./storage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`Claude Weixin Connect — Claude AI in WeChat

Usage:
  npx tsx src/index.ts login                    QR code login
  npx tsx src/index.ts start [--account <id>]   Start bot
  npx tsx src/index.ts accounts                 List accounts
  npx tsx src/index.ts logout --account <id>    Remove account
  npx tsx src/index.ts status                   Show status
`);
}

function resolveDataDir(): string {
  try {
    return getConfig().weixin.dataDir;
  } catch {
    return "./data";
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdLogin(): Promise<void> {
  const cfg = getConfig();

  console.log("=== Claude Weixin Connect — 微信扫码登录 ===\n");

  const startResult = await startWeixinLoginWithQr({
    apiBaseUrl: cfg.weixin.defaultApiBaseUrl,
  });

  if (!startResult.qrcodeUrl) {
    console.error(startResult.message);
    process.exit(1);
  }

  console.log(startResult.message);
  await displayQRCode(startResult.qrcodeUrl);

  const waitResult = await waitForWeixinLogin({
    sessionKey: startResult.sessionKey,
    apiBaseUrl: cfg.weixin.defaultApiBaseUrl,
  });

  if (waitResult.connected) {
    console.log(`\n✅ 登录成功！`);
    console.log(`   Account ID: ${waitResult.accountId}`);
    console.log(`   User ID:    ${waitResult.userId}`);
    console.log(`   Base URL:   ${waitResult.baseUrl ?? cfg.weixin.defaultApiBaseUrl}`);
    console.log(`\n现在可以运行: npx tsx src/index.ts start`);
  } else if (waitResult.alreadyConnected) {
    console.log(waitResult.message);
  } else {
    console.error(`\n❌ 登录失败: ${waitResult.message}`);
    process.exit(1);
  }
}

async function cmdStart(accountId?: string): Promise<void> {
  // Resolve account
  const ids = listAccountIds();
  if (ids.length === 0) {
    console.error("没有已登录的账号。请先运行: npx tsx src/index.ts login");
    process.exit(1);
  }

  const targetId = accountId ?? ids[0];
  const account = loadAccount(targetId);
  if (!account) {
    console.error(
      `账号 "${targetId}" 不存在。可用账号: ${ids.join(", ") || "(无)"}`,
    );
    process.exit(1);
  }

  console.log(`=== Claude Weixin Connect — 启动中 ===`);
  console.log(`   Account: ${account.accountId}`);
  console.log(`   API URL: ${account.baseUrl}`);

  // Configure the API layer
  setApiBotAgent(getConfig().weixin.botAgent);
  setApiRouteTag("");
  setLogDir(resolveDataDir());

  // Dynamically import bot.ts to avoid loading it for other commands
  const { startBot } = await import("./bot.js");
  await startBot(account);
}

async function cmdAccounts(): Promise<void> {
  const ids = listAccountIds();
  if (ids.length === 0) {
    console.log("没有已登录的账号。");
    return;
  }
  console.log("已登录账号:");
  for (const id of ids) {
    const acc = loadAccount(id);
    if (acc) {
      console.log(`  - ${acc.accountId} (user: ${acc.userId}, saved: ${acc.savedAt})`);
    }
  }
}

async function cmdLogout(accountId: string): Promise<void> {
  const account = loadAccount(accountId);
  if (!account) {
    console.error(`账号 "${accountId}" 不存在。`);
    process.exit(1);
  }
  removeAccount(accountId);
  console.log(`✅ 已移除账号: ${accountId}`);
}

async function cmdStatus(): Promise<void> {
  const ids = listAccountIds();
  console.log(`Claude Weixin Connect 状态`);
  console.log(`  数据目录: ${resolveDataDir()}`);
  console.log(`  已登录账号: ${ids.length} 个`);
  for (const id of ids) {
    const acc = loadAccount(id);
    if (acc) {
      console.log(`    - ${acc.accountId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  // Load config (may print warnings if config.json missing)
  loadConfig();

  switch (command) {
    case "login":
      await cmdLogin();
      break;
    case "start": {
      // Parse --account <id>
      const accountIdx = args.indexOf("--account");
      const accountId =
        accountIdx !== -1 ? args[accountIdx + 1] : undefined;
      await cmdStart(accountId);
      break;
    }
    case "accounts":
      await cmdAccounts();
      break;
    case "logout": {
      const logoutIdx = args.indexOf("--account");
      if (logoutIdx === -1 || !args[logoutIdx + 1]) {
        console.error("请指定账号: logout --account <id>");
        process.exit(1);
      }
      await cmdLogout(args[logoutIdx + 1]);
      break;
    }
    case "status":
      await cmdStatus();
      break;
    default:
      printUsage();
      break;
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
