# Claude Weixin Connect — 开发日志

## 项目概述

基于微信 iLink Bot 协议，将 Claude AI 直接接入微信的独立桥接程序。
从 `@tencent-weixin/openclaw-weixin` 提取协议层，用 Claude API 替代 OpenClaw 框架。

- **仓库：** https://github.com/Qianmaidou/Claude-weixin-connect
- **基础协议：** 微信 iLink Bot（HTTP 长轮询 + CDN 媒体）
- **AI 后端：** Anthropic Claude API

---

## 开发步骤记录

### Step 0: 项目初始化 + Git 配置 ✅ (2026-06-05)

**做了什么：**
- 创建项目目录 `Claude-weixin-connect/`
- 初始化 Git 仓库，关联 GitHub remote
- 配置 `package.json`（ESM, Node >= 22）
- 配置 `tsconfig.json`（strict, ESNext, NodeNext）
- 配置 `.gitignore`（node_modules, dist, .env, data/）
- 创建 `.env.example`（CLAUDE_API_KEY）
- 创建 `README.md` 占位
- 安装依赖：`@anthropic-ai/sdk`, `qrcode-terminal`, `zod`
- 安装开发依赖：`typescript`, `tsx`, `vitest`, `@types/node`, `silk-wasm`

**文件变更：**
- 新建：`package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `README.md`, `package-lock.json`

**提交：** `chore: initialize project scaffold`

---

### Step 1: 提取协议类型定义 ✅ (2026-06-05)

**做了什么：**
- 从 openclaw-weixin 原样提取 `src/api/types.ts`
- 放置到 `src/weixin/api/types.ts`
- 纯 TypeScript 接口/类型/常量定义，零外部依赖
- 包含：BaseInfo, MessageType, MessageItemType, MessageState, WeixinMessage,
  GetUpdatesReq/Resp, SendMessageReq/Resp, CDN 媒体类型, 各 Item 类型等

**验证：** `npx tsc --noEmit` 通过

**文件变更：**
- 新建：`src/weixin/api/types.ts`

**提交：** `chore: extract protocol type definitions from openclaw-weixin`

---

### Step 2: 提取工具函数 ✅ (2026-06-05)

**做了什么：**
- 从 openclaw-weixin 提取以下文件：

1. **`src/weixin/util/random.ts`** — ID 生成工具
   - `generateId(prefix)` — 时间戳 + 随机 hex 生成唯一 ID
   - `tempFileName(prefix, ext)` — 临时文件名生成

2. **`src/weixin/util/redact.ts`** — 敏感数据脱敏
   - `truncate()` — 字符串截断
   - `redactToken()` — Token/密钥脱敏（只显示前几个字符）
   - `redactBody()` — JSON 请求体脱敏
   - `redactUrl()` — URL 查询参数脱敏

3. **`src/weixin/util/logger.ts`** — JSON 行日志（简化版）
   - **改动：** 移除 `resolvePreferredOpenClawTmpDir`（OpenClaw 依赖）
   - 改为使用 `data/` 目录，支持 `setLogDir()` 自定义
   - 环境变量 `LOG_LEVEL` 控制日志级别
   - 日志格式：JSON 行写入 `data/bridge-YYYY-MM-DD.log`

**验证：** `npx tsc --noEmit` 通过

**文件变更：**
- 新建：`src/weixin/util/random.ts`
- 新建：`src/weixin/util/redact.ts`
- 新建：`src/weixin/util/logger.ts`

**提交：** `chore: extract utility functions (random, redact, logger)`

---

### Step 3: 提取 AES 加密 ✅ (2026-06-05)

**做了什么：**
- 从 openclaw-weixin 原样提取 `src/cdn/aes-ecb.ts` → `src/weixin/cdn/aes-ecb.ts`
- 零依赖，纯 Node.js crypto 实现：
  - `encryptAesEcb(plaintext, key)` — AES-128-ECB 加密（PKCS7 填充）
  - `decryptAesEcb(ciphertext, key)` — AES-128-ECB 解密
  - `aesEcbPaddedSize(plaintextSize)` — 计算 PKCS7 填充后大小

**验证：**
- `npx tsc --noEmit` 通过
- `npx vitest run` 3 个测试通过（加解密往返、大块数据、填充大小计算）

**文件变更：**
- 新建：`src/weixin/cdn/aes-ecb.ts`
- 新建：`src/weixin/cdn/aes-ecb.test.ts`

**提交：** `chore: extract AES-128-ECB encryption for CDN media`

---

### Step 4: 提取 HTTP API 层 ✅ (2026-06-05)

**做了什么：**
- 从 openclaw-weixin 提取并适配 3 个文件：

1. **`src/weixin/api/api.ts`** — 核心 HTTP API 层（~400 行）
   - 6 个微信 API 端点：`getUpdates`, `sendMessage`, `getUploadUrl`, `getConfig`, `sendTyping`, `notifyStart`, `notifyStop`
   - 2 个底层 fetch 封装：`apiPostFetch`, `apiGetFetch`
   - **改动：**
     - 硬编码 `CHANNEL_VERSION = "1.0.0"`、`ILINK_APP_ID = "bot"`（不再读取 package.json）
     - 移除 `loadConfigBotAgent()` / `loadConfigRouteTag()` 调用（OpenClaw 依赖）
     - 改为 `setApiBotAgent()` / `setApiRouteTag()` setter 函数
     - `buildBaseInfo()` 使用模块级存储的 bot_agent 值
     - 所有 import 路径改为我们的 `../util/` 和 `./types.js`

2. **`src/weixin/api/config-cache.ts`** — typing ticket 缓存管理器
   - 24 小时 TTL，失败指数退避重试（最多 1 小时）
   - **无改动**

3. **`src/weixin/api/session-guard.ts`** — 会话过期守卫
   - errcode -14 时暂停 1 小时
   - `pauseSession`, `isSessionPaused`, `assertSessionActive`
   - **无改动**

**验证：** `npx tsc --noEmit` 通过

**文件变更：**
- 新建：`src/weixin/api/api.ts`
- 新建：`src/weixin/api/config-cache.ts`
- 新建：`src/weixin/api/session-guard.ts`

**提交：** `chore: extract WeChat iLink HTTP API layer`

---

### Step 5: 提取消息发送 + Markdown 过滤 ✅ (2026-06-05)

**做了什么：**
- 从 openclaw-weixin 提取以下文件：

1. **`src/weixin/messaging/send.ts`** — 出站消息发送
   - `sendMessageWeixin()` — 发送纯文本消息
   - `sendImageMessageWeixin()` — 发送图片消息（CDN 引用）
   - `sendVideoMessageWeixin()` — 发送视频消息
   - `sendFileMessageWeixin()` — 发送文件附件
   - `buildSendMessageReq()` / `buildTextMessageReq()` — 请求构建
   - **改动：** 移除 `ReplyPayload`（OpenClaw 类型）→ 本地定义
   - **改动：** `UploadedFileInfo` 改为从 `types.ts` 导入
   - **改动：** clientId 前缀改为 `claude-weixin`

2. **`src/weixin/messaging/markdown-filter.ts`** — 流式 Markdown 过滤器
   - 字符级状态机，实时过滤不支持的 Markdown 语法
   - 支持代码块、表格、分割线、粗体/斜体
   - 过滤 CJK 斜体、H5/H6、图片语法
   - **无改动，原样复制**

3. **`src/weixin/media/mime.ts`** — MIME 类型工具
   - 扩展名 ↔ MIME 类型映射
   - `getMimeFromFilename()`, `getExtensionFromMime()`, `getExtensionFromContentTypeOrUrl()`
   - **无改动，原样复制**

4. **`src/weixin/api/types.ts`** — 新增 `UploadedFileInfo` 类型（CDN 上传结果，多模块共享）

**验证：** `npx tsc --noEmit` 通过

**文件变更：**
- 新建：`src/weixin/messaging/send.ts`
- 新建：`src/weixin/messaging/markdown-filter.ts`
- 新建：`src/weixin/media/mime.ts`
- 修改：`src/weixin/api/types.ts`（新增 UploadedFileInfo）

**提交：** `chore: extract message sending and markdown filter`

---

### Step 6: 提取 CDN 媒体上传/下载 ✅ (2026-06-05)

**做了什么：**
- 从 openclaw-weixin 提取以下 CDN 和媒体文件：

1. **`src/weixin/cdn/cdn-url.ts`** — CDN URL 构建
   - `buildCdnDownloadUrl()` / `buildCdnUploadUrl()`
   - 支持 `ENABLE_CDN_URL_FALLBACK` 模式
   - **无改动，原样复制**

2. **`src/weixin/cdn/cdn-upload.ts`** — CDN 上传（AES 加密 + 重试）
   - `uploadBufferToCdn()` — 加密 → POST → 获取 x-encrypted-param
   - 最多 3 次重试，4xx 立即中止
   - **无改动，原样复制**

3. **`src/weixin/cdn/pic-decrypt.ts`** — CDN 下载 + AES 解密
   - `downloadAndDecryptBuffer()` — 下载密文 → AES 解密
   - `downloadPlainCdnBuffer()` — 下载明文
   - 支持两种 AES key 编码格式（raw base64 / hex-in-base64）
   - **无改动，原样复制**

4. **`src/weixin/cdn/upload.ts`** — 上传流水线
   - `uploadFileToWeixin()`, `uploadVideoToWeixin()`, `uploadFileAttachmentToWeixin()`
   - `downloadRemoteImageToTemp()` — 远程图片下载
   - **改动：** `UploadedFileInfo` 从 `types.ts` 导入（消除重复定义）

5. **`src/weixin/media/media-download.ts`** — 入站媒体下载解密
   - `downloadMediaFromItem()` — 支持 IMAGE/VOICE/FILE/VIDEO 四种类型
   - SILK 语音自动转 WAV
   - **改动：** 定义 `SaveMediaFn` 和 `WeixinInboundMediaOpts` 类型（替代 OpenClaw 类型）
   - **改动：** 内联 `MessageItemType_T` 类型推断

6. **`src/weixin/media/silk-transcode.ts`** — SILK → WAV 转码
   - 调用 `silk-wasm` 动态 import
   - 失败时返回 null（优雅降级）
   - **无改动，原样复制**

7. **`src/weixin/messaging/send-media.ts`** — 媒体文件发送路由
   - `sendWeixinMediaFile()` — 按 MIME 类型路由到对应上传+发送函数
   - **无改动（仅 import 路径更新）**

**验证：** `npx tsc --noEmit` 通过

**文件变更：**
- 新建：`src/weixin/cdn/cdn-url.ts`
- 新建：`src/weixin/cdn/cdn-upload.ts`
- 新建：`src/weixin/cdn/pic-decrypt.ts`
- 新建：`src/weixin/cdn/upload.ts`
- 新建：`src/weixin/media/media-download.ts`
- 新建：`src/weixin/media/silk-transcode.ts`
- 新建：`src/weixin/messaging/send-media.ts`

**提交：** `chore: extract CDN media upload and download`

---

### Step 7: 实现配置系统 ✅ (2026-06-05)

**做了什么：**
- 创建 `src/config.ts` — 自己的配置系统（替代 OpenClaw config）

1. **Zod Schema 定义：**
   - `ClaudeConfigSchema` — apiKey, model, maxTokens, temperature
   - `WeixinConfigSchema` — dataDir, botAgent, ilinkAppId, 默认 API/CDN URL
   - `ConversationConfigSchema` — maxHistoryMessages, maxContextTokens
   - `BridgeConfigSchema` — 组合以上 + allowedUsers + systemPromptFile

2. **环境变量替换：**
   - `resolveEnvVars()` — `${CLAUDE_API_KEY}` → 实际值
   - 支持深层嵌套对象的递归替换

3. **配置加载：**
   - `loadConfig(path?)` — 从 JSON 文件加载 + Zod 校验
   - 校验失败时打印警告，回退到默认值
   - `getConfig()` — 获取已加载的配置（自动懒加载默认值）
   - 配置路径：`${BRIDGE_DATA_DIR}/config.json` 或 `./data/config.json`

4. **单元测试：**
   - `config.test.ts` — 5 个测试用例
   - 覆盖：最小配置/默认值填充/字段校验/完整配置/DEFAULT_CONFIG

**验证：** `npx tsc --noEmit` + `npx vitest run` 5 tests passed

**文件变更：**
- 新建：`src/config.ts`
- 新建：`src/config.test.ts`

**提交：** `feat: config system with Zod schema and env substitution`

---

### Step 8: 实现存储层 ✅ (2026-06-05)

**做了什么：**
- 创建 `src/storage.ts` — 自己的持久化层（替代 OpenClaw 的 account store + sync buffer + context token + session）

1. **账户管理：**
   - `saveAccount()`, `loadAccount()`, `listAccountIds()`, `removeAccount()`
   - `normalizeAccountId()` — `@` → `-` 替换（内联自 OpenClaw）
   - 账户索引文件 `accounts.json` + 独立凭证文件

2. **Sync Buffer：**
   - `loadSyncBuf()`, `saveSyncBuf()` — get_updates_buf 游标持久化

3. **Context Token：**
   - `getContextToken()`, `setContextToken()` — userId → contextToken 映射

4. **对话历史：**
   - `loadConversation()`, `saveConversation()` — 每用户独立 JSON 文件
   - `pruneConversation()` — 滑动窗口裁剪
   - `estimateTokens()` — 粗略 token 估算（4 字符 ≈ 1 token）

5. **临时文件目录：**
   - `getTempDir()` — `{dataDir}/tmp/`

**目录结构：**
```
{dataDir}/
  accounts.json
  accounts/{accountId}.json
  accounts/{accountId}.sync.json
  accounts/{accountId}.context-tokens.json
  conversations/{accountId}/{userId}.json
  tmp/
```

**验证：** `npx tsc --noEmit` + `npx vitest run` 15 tests passed

**文件变更：**
- 新建：`src/storage.ts`
- 新建：`src/storage.test.ts`

**提交：** `feat: storage layer for accounts, sync buffers, and conversations`

---

### Step 9: 适配扫码登录 ✅ (2026-06-05)

**做了什么：**
- 从 openclaw-weixin 提取并适配 `login-qr.ts` → `src/weixin/auth/login-qr.ts`

1. **扫码登录流程（完整保留）：**
   - `startWeixinLoginWithQr()` — 发起扫码登录，获取 QR code
   - `waitForWeixinLogin()` — 轮询扫码状态直到确认/过期/超时
   - `displayQRCode()` — 终端显示二维码 + 备用链接
   - 支持验证码（`need_verifycode`）、IDC 重定向（`scaned_but_redirect`）
   - QR 码过期自动刷新（最多 3 次）
   - 验证错误封锁后自动刷新重试

2. **关键改动：**
   - `getLocalBotTokenList()` — 用我们的 `listAccountIds()` + `loadAccount()` 替换 OpenClaw 的账户管理
   - `confirmed` 状态处理 — 自动调用 `saveAccount()` 保存凭证
   - 文案修改：`OpenClaw` → `Claude Weixin Connect`
   - Import 路径适配到我们的模块结构

3. **类型声明：**
   - 创建 `src/vendor.d.ts` — qrcode-terminal 和 silk-wasm 的类型声明

**验证：** `npx tsc --noEmit` 通过

**文件变更：**
- 新建：`src/weixin/auth/login-qr.ts`
- 新建：`src/vendor.d.ts`

**提交：** `feat: adapt QR code login flow to our storage layer`

---

### Step 10-12: Claude API 封装 + CLI + Bot 主循环（MVP）✅ (2026-06-05)

**做了什么：** 实现核心桥接逻辑——三个文件共同构成最小可行产品。

1. **`src/claude.ts`** — Claude API 流式封装
   - `streamClaudeResponse()` — 流式 async generator，产出 text_delta
   - `claudeComplete()` — 简单非流式调用（用于 slash 命令等）
   - 指数退避重试（最多 3 次）：429/5xx/网络错误可重试，401/403/400 立即抛错
   - 使用 `@anthropic-ai/sdk` 的 `client.messages.stream()`

2. **`src/index.ts`** — CLI 入口
   - 命令：`login`, `start`, `accounts`, `logout`, `status`
   - `login` — QR 码扫码登录流程
   - `start [--account <id>]` — 启动 bot（默认第一个账号）
   - `accounts` — 列出已登录账号
   - `logout --account <id>` — 移除账号
   - `status` — 显示运行状态
   - 启动时配置 API 层（bot_agent, routeTag, logDir）

3. **`src/bot.ts`** — 主循环（核心 ~350 行）
   - **长轮询循环：** getUpdates(cursor) → 处理消息 → 保存 cursor → 循环
   - **消息处理管线：**
     1. 提取文本（`extractText`）
     2. 授权检查（`allowedUsers` 白名单）
     3. 保存 context_token
     4. 加载对话历史 → 追加用户消息
     5. 流式调用 Claude → `StreamingMarkdownFilter` 过滤
     6. 200 字符 / 3s 空闲合并块 → sendMessage（GENERATING）
     7. 最后一块 → flush + FINISH
     8. 保存 Claude 回复 → 裁剪对话历史
   - **Typing Indicator：** setInterval 5s 保活，结束时发送 CANCEL
   - **会话守卫：** errcode -14 → 暂停 1 小时
   - **错误处理：** 连续 3 次失败 → 退避 30s
   - **优雅关闭：** SIGINT/SIGTERM → notifyStop → 保存 sync buffer
   - **System Prompt：** 从文件加载或使用内置默认值

**验证：** `npx tsc --noEmit` + `npx vitest run` 23 tests passed

**文件变更：**
- 新建：`src/claude.ts`
- 新建：`src/index.ts`
- 新建：`src/bot.ts`

**提交：** `feat: Claude API wrapper, CLI, and bot main loop (MVP)`

---

### Step 13-15: Slash 命令 + 入站图片支持 ✅ (2026-06-05)

**做了什么：**

1. **Slash 命令系统（`handleSlashCommand`）：**
   - `/help` — 显示可用命令
   - `/reset` — 重置对话历史
   - `/status` — 显示模型、对话条数、token 估算
   - `/model <名称>` — 切换 Claude 模型（内存中，重启重置）
   - `sendQuickReply()` — 命令响应快速回复辅助函数

2. **入站图片支持（Claude Vision）：**
   - `downloadInboundImage()` — 从微信 CDN 下载并解密图片
     - 支持 `image_item.aeskey`（hex）和 `media.aes_key`（base64）两种 key 格式
     - 无 AES key 时回退到明文下载
   - 图片转 base64 → 构建 `ContentBlockParam[]` → Claude Vision API
   - 对话历史中保存 `[包含 N 张图片]` 标记（图片不持久化）

3. **类型扩展：**
   - `ClaudeMessage` 类型（→ `claude.ts`）— 支持 `string | ContentBlockParam[]`
   - `streamReply()` 接受 `ClaudeMessage[]` 而非 `ConversationEntry[]`
   - 用户模型偏好 Map（`userModelPrefs`）集成到流式调用

**验证：** `npx tsc --noEmit` + `npx vitest run` 23 tests passed

**文件变更：**
- 修改：`src/bot.ts`（+120 行：slash commands + image download + type changes）
- 修改：`src/claude.ts`（新增 `ClaudeMessage` 类型导出）

**提交：** `feat: slash commands and inbound image support (Claude Vision)`

---

### Step 16-20: README 文档 + 配置示例 + 最终打磨 ✅ (2026-06-05)

**做了什么：**

1. **`README.md`** — 完整项目文档
   - 功能列表、快速开始、安装步骤
   - CLI 命令参考、Slash 命令参考
   - 配置参考（完整 JSON schema + 字段说明）
   - 目录结构图、架构图（ASCII）
   - 技术栈说明、开发指南

2. **`config.example.json`** — 示例配置文件
   - 所有可选字段 + 默认值
   - `${CLAUDE_API_KEY}` 环境变量占位

3. **`system-prompt.example.md`** — 示例 System Prompt
   - 中英双语指导
   - 礼貌、简洁、能力边界

**验证：** 文档审阅完成

**文件变更：**
- 修改：`README.md`（重写为完整文档）
- 新建：`config.example.json`
- 新建：`system-prompt.example.md`

**提交：** `docs: complete README with setup guide, config reference, and examples`

---

## 项目总结

### 当前状态

Claude Weixin Connect 已实现核心微信 Bot 功能：
- ✅ 微信 iLink Bot 协议完整实现（6 个 API 端点 + CDN 媒体）
- ✅ 扫码登录 + 多账号管理
- ✅ Claude AI 流式回复 + Typing Indicator
- ✅ 对话上下文管理（滑动窗口 + Token 限制）
- ✅ Slash 命令（/help, /reset, /status, /model）
- ✅ Claude Vision 图片识别
- ✅ 23 个单元测试通过
- ✅ 完整项目文档

### 文件统计

| 类型 | 文件数 | 行数（约） |
|------|--------|-----------|
| 协议层 (weixin/) | 17 | ~2,500 |
| 核心逻辑 (config, storage, claude, bot) | 4 | ~700 |
| CLI (index) | 1 | ~160 |
| 测试 | 3 | ~340 |
| 配置/文档 | 7 | ~250 |
| **总计** | **32** | **~4,000** |

### 技术亮点

1. **无框架依赖：** 完整去除了 OpenClaw 框架耦合，仅依赖 `@anthropic-ai/sdk`
2. **协议完整性：** 从 openclaw-weixin 提取了完整的微信 iLink Bot 协议实现
3. **流式体验：** 200 字符/3s 合并块 + Markdown 实时过滤 + Typing Indicator
4. **容错设计：** 会话过期自动暂停、连续失败退避、网络中断重连
5. **可扩展：** 模块化架构，协议层与 AI 层完全分离
