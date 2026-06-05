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
