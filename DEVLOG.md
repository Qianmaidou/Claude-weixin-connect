# Claude Weixin Connect — 开发日志

## 项目概述

将 AI 大模型接入微信的独立桥接程序。从腾讯开源的 `@tencent-weixin/openclaw-weixin`（OpenClaw 微信渠道插件）提取 iLink Bot 协议层，用自建的 AI 层替代 OpenClaw 框架。

**GitHub：** https://github.com/Qianmaidou/Claude-weixin-connect  
**开始日期：** 2026-06-05  
**当前状态：** MVP 完成，文字聊天可用，支持 DeepSeek / Claude 双后端

---

## 技术选型

| 决策 | 选择 | 理由 |
|------|------|------|
| 协议代码 | 从 openclaw-weixin 提取而非 fork | 避免携带 1100+ 行 OpenClaw 胶水代码 |
| AI 后端 | 双后端（Anthropic + OpenAI 兼容） | 用户用的是 DeepSeek API |
| 运行时 | TypeScript ESM (Node ≥ 22) | 与原项目一致，类型安全 |
| 消息处理 | 串行处理 | 保证 context_token 顺序 |
| 对话存储 | JSON 文件 | 简单可调试，无需数据库 |
| 流式策略 | 200 字符 / 3s 空闲合并块 | 适配微信消息节奏 |
| 配置 | Zod schema + .env 环境变量 | 类型安全 + 灵活切换后端 |

---

## 开发过程

### 第 1 阶段：协议层提取（Steps 0-6）

从 `@tencent-weixin/openclaw-weixin` 提取了微信 iLink Bot 协议的完整实现。

**提取的模块（17 个文件，~2,500 行）：**

| 目录 | 文件 | 说明 | 改动 |
|------|------|------|------|
| `weixin/api/` | `types.ts` | 协议类型定义（接口、常量） | 新增 `UploadedFileInfo` 类型 |
| | `api.ts` | 6 个 HTTP API 端点封装 | 硬编码版本号/AppId；`botAgent` 和 `routeTag` 改为 setter 函数 |
| | `config-cache.ts` | typing ticket 缓存（24h TTL） | 无 |
| | `session-guard.ts` | 会话过期暂停（errcode -14） | 无 |
| `weixin/util/` | `random.ts`, `redact.ts` | ID 生成、敏感数据脱敏 | 无 |
| | `logger.ts` | JSON 行日志 | 去掉 `resolvePreferredOpenClawTmpDir` → 改用 `data/` 目录 |
| `weixin/cdn/` | `aes-ecb.ts` | AES-128-ECB 加解密 | 无（纯 crypto） |
| | `cdn-url.ts`, `cdn-upload.ts` | CDN URL 构建、上传（加密+重试） | 无 |
| | `pic-decrypt.ts` | CDN 下载解密 | 无 |
| | `upload.ts` | 上传流水线（图片/视频/文件） | `UploadedFileInfo` 从 `types.ts` 导入 |
| `weixin/messaging/` | `send.ts` | 出站消息发送（文本/图片/视频/文件） | 去掉 `ReplyPayload`（OpenClaw 类型）；clientId 前缀改 `claude-weixin` |
| | `send-media.ts` | 媒体文件上传+发送路由 | 仅 import 路径更新 |
| | `markdown-filter.ts` | 流式 Markdown 过滤器（状态机） | 无 |
| `weixin/media/` | `mime.ts` | MIME 类型映射 | 无 |
| | `media-download.ts` | 入站媒体下载解密（IMAGE/VOICE/FILE/VIDEO） | `SaveMediaFn` 和 `WeixinInboundMediaOpts` 类型改为本地定义 |
| | `silk-transcode.ts` | SILK → WAV 转码 | 无 |
| `weixin/auth/` | `login-qr.ts` | 扫码登录流程 | `listIndexedWeixinAccountIds` / `loadWeixinAccount` → 我们的 `storage.ts` |

### 第 2 阶段：自建基础设施（Steps 7-9）

#### Step 7：配置系统（`src/config.ts`）

- **Zod schema**：`AIConfig`（provider + apiKey + model + baseURL + maxTokens + temperature）、`WeixinConfig`、`ConversationConfig`
- **环境变量加载**：自动读取 `.env` 文件并注入 `process.env`
- **变量替换**：支持 `${VAR}` 和 `$VAR` 两种格式
- **双后端支持**：`provider: "anthropic"` | `"openai-compatible"`
- **自动检测**：如果检测到 `DEEPSEEK_API_KEY` 环境变量，自动切换为 OpenAI 兼容模式
- **向后兼容**：同时支持 `ai` 和 `claude`（废弃别名）配置键
- 5 个单元测试

#### Step 8：存储层（`src/storage.ts`）

替代 OpenClaw 的 account store / sync buffer / context token / session 管理：

- **账户 CRUD**：`saveAccount` / `loadAccount` / `listAccountIds` / `removeAccount`
- **Sync Buffer**：`loadSyncBuf` / `saveSyncBuf`（getUpdates 游标持久化）
- **Context Token**：`getContextToken` / `setContextToken`（userId → contextToken 映射）
- **对话历史**：`loadConversation` / `saveConversation` / `pruneConversation` / `estimateTokens`
- **内联工具**：`normalizeAccountId`（`@` → `-`）、`getTempDir`
- 15 个单元测试

#### Step 9：扫码登录适配（`src/weixin/auth/login-qr.ts`）

- `getLocalBotTokenList()` → 替换为 `listAccountIds()` + `loadAccount()`
- 登录成功自动调用 `saveAccount()` 保存凭证
- 文案改用 `Claude Weixin Connect`

### 第 3 阶段：核心 MVP（Steps 10-12）

#### Step 10：AI 层（`src/claude.ts`）

双后端流式 AI 封装：

- **`streamClaudeResponse()`**：统一流式接口，根据 config 自动选择后端
- **`streamAnthropic()`**：使用 `@anthropic-ai/sdk` 的 `messages.stream()`
- **`streamOpenAI()`**：使用 `openai` SDK 的 `chat.completions.create({ stream: true })`
- **图片格式转换**：Anthropic `ContentBlockParam` ↔ OpenAI `ContentPart`
- **指数退避重试**：最多 3 次，区分可重试（429/5xx/网络）和不可重试（401/403/400）
- **非流式备用**：`claudeComplete()` 用于 slash 命令快速响应

#### Step 11：CLI（`src/index.ts`）

- `login` — 扫码登录
- `start [--account <id>]` — 启动 Bot
- `accounts` / `logout` / `status`

#### Step 12：Bot 主循环（`src/bot.ts`）

这是核心文件，替换了 `monitor.ts` + `process-message.ts`：

```
while (running):
  getUpdates(cursor, 35s timeout)
  ↓
  对每条消息:
    → 提取文本 / 下载 CDN 图片
    → Slash 命令检查（/reset /status /model /help）
    → 授权检查（allowedUsers 白名单）
    → 加载对话历史 → 追加用户消息
    → 流式调用 AI → StreamingMarkdownFilter → 200chars/3s 合并块
    → 发送 GENERATING 块 → 最后 FINISH
    → 保存 AI 回复 → 裁剪对话历史
  ↓
  SIGINT/SIGTERM → notifyStop → 保存状态 → 退出
```

### 第 4 阶段：功能完善（Steps 13-15）

#### Slash 命令

| 命令 | 功能 |
|------|------|
| `/help` | 显示可用命令 |
| `/reset` | 清空对话历史 |
| `/status` | 显示模型、对话条数、Token 估算 |
| `/model <名称>` | 切换模型（内存中，重启重置） |

#### 入站图片支持

- 从微信 CDN 下载 → AES 解密 → 转 base64
- 构建 Claude Vision `ContentBlockParam` 数组
- DeepSeek 不支持图片时自动降级为文字提示

### 第 5 阶段：调试与修复（Steps 16-20）

实际运行中遇到的问题和修复：

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | `Config validation errors: claude: Required` | `.env` 文件未自动加载到 `process.env` | 添加 `loadEnvFile()` 函数 |
| 2 | `$DEEPSEEK_API_KEY` 未被替换为实际值 | `resolveEnvVars` 只匹配 `${VAR}` 格式，不匹配 `$VAR` | 正则增加 `$VAR` 格式 |
| 3 | `401 api key invalid` | 用户使用的 key 不是有效的 DeepSeek API Key | 用户重新创建有效 Key |
| 4 | 启动后 Bot 收到消息但无回复 | 最终 flush 逻辑有 bug：`filter.flush()` 前未 feed 缓冲区 | 改为先 `filter.feed(buffer)` 再 `filter.flush()` |
| 5 | 纯图片消息被跳过无响应 | `extractText()` 返回空 → `return` 跳过了图片处理 | 当有图片附件时跳过空文本检查 |
| 6 | DeepSeek 报 `400 unknown variant 'image_url'` | DeepSeek API 不支持图片内容块 | 发送前检测并剥离图片，替换为文字提示 |

---

## 文件统计

| 类别 | 文件 | 行数（约） |
|------|------|-----------|
| 协议层 (`src/weixin/`) | 17 | 2,600 |
| 核心逻辑 (`src/config.ts`, `storage.ts`, `claude.ts`, `bot.ts`) | 4 | 900 |
| CLI (`src/index.ts`) | 1 | 170 |
| 测试 (`*.test.ts`) | 3 | 370 |
| 类型声明、配置、文档 | 9 | 300 |
| **总计** | **34** | **~4,300** |

## 测试

```bash
npm test   # vitest, 24 个测试全部通过
```

```
 ✓ src/weixin/cdn/aes-ecb.test.ts (3 tests)
 ✓ src/config.test.ts (6 tests)
 ✓ src/storage.test.ts (15 tests)
```

## Git 提交历史

```
828b316 fix: allow image-only messages
ae4b21c fix: strip images for DeepSeek (text-only API), convert to text note
c32281f debug: image download logging + fix syntax
27fe975 fix: final flush correctly feeds buffer through markdown filter
ed140a8 debug: streamReply logging
ebe455f debug: streaming response chunk logging
eebc888 fix: env var resolution now supports both $VAR and ${VAR} formats
c9d8dab debug: print API baseURL and use /v1 path for DeepSeek
cf472d1 fix: show API errors in console for debugging
ab73b90 feat: OpenAI-compatible backend support (DeepSeek, etc.)
b4f2fc5 fix: load .env file, apiKey fallback, and startup console messages
7948c15 docs: complete README with setup guide, config reference, and examples
e42a3bf feat: slash commands and inbound image support (Claude Vision)
d95efde feat: Claude API wrapper, CLI, and bot main loop (MVP)
889a5ce feat: adapt QR code login flow to our storage layer
1bdb31b feat: storage layer for accounts, sync buffers, and conversations
7720e95 feat: config system with Zod schema and env substitution
bdae074 chore: extract CDN media upload and download
47790d0 chore: extract message sending and markdown filter
8be10c1 chore: extract WeChat iLink HTTP API layer
a7325bb chore: extract AES-128-ECB encryption for CDN media
ec77d91 chore: extract utility functions (random, redact, logger)
acb0f93 chore: extract protocol type definitions from openclaw-weixin
d4ec035 chore: initialize project scaffold
```

---

## 遗留工作

以下功能有明确的技术可行路径，按需实现：

| 功能 | 难度 | 方案 |
|------|------|------|
| 入站语音 | 中 | SILK → WAV 转码已有 → Whisper API 转文字 → 传给 AI |
| 入站文件 | 低 | CDN 下载解密已有 → 提取文件名/大小 → 文字描述传给 AI |
| 出站媒体 | 中 | AI 回复识别 `MEDIA:` 指令 → CDN 上传 → sendMessage |
| 群聊支持 | 高 | `group_id` 字段已有，需群聊路由逻辑 |
| Web 管理面板 | 中 | 添加 Express 服务 + 简单 HTML 页面 |

## 总结

这个项目从腾讯开源的 OpenClaw 插件出发，提取了完整的微信 iLink Bot 协议实现，并构建了自己的 AI 桥接层。最终产物是一个约 4,300 行的独立 TypeScript 项目，能够将 DeepSeek 或 Claude 直接接入微信，支持文字聊天、图片识别（仅 Claude）、对话上下文记忆和 Slash 命令。

项目的核心价值在于证明了：**不需要 OpenClaw 这个重框架，也无需等待微信开放更多权限，用现有的 ClawBot 协议就能直接搭建一个可用的微信 AI Bot。**
