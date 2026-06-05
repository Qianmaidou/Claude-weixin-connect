# Claude Weixin Connect

将 **Claude AI** 直接接入**微信**（WeChat）的独立桥接程序。

基于微信 iLink Bot 协议，从 `@tencent-weixin/openclaw-weixin` 提取协议层，用 Anthropic Claude API 替代 OpenClaw 框架。

## 功能

- ✅ 扫码登录微信 Bot
- ✅ 文字消息收发（Claude 流式回复 + Typing Indicator）
- ✅ 入站图片支持（Claude Vision — 图片描述/识别）
- ✅ 对话上下文管理（滑动窗口、Token 限制）
- ✅ Slash 命令（`/help`, `/reset`, `/status`, `/model`）
- ✅ 多账号管理
- 🚧 入站语音/文件（框架已就绪）
- 🚧 出站媒体（Claude 生成图片/文件发送）

## 快速开始

### 前置条件

- Node.js >= 22
- Anthropic API Key（[获取](https://console.anthropic.com/)）

### 安装

```bash
git clone https://github.com/Qianmaidou/Claude-weixin-connect.git
cd Claude-weixin-connect
npm install
```

### 配置

1. 创建 `.env` 文件：
```bash
cp .env.example .env
# 编辑 .env，填入你的 CLAUDE_API_KEY
```

2. （可选）创建 `data/config.json` 自定义配置：
```bash
cp config.example.json data/config.json
```

### 登录

```bash
npx tsx src/index.ts login
```

终端会显示二维码，用微信扫描即可登录。

### 启动

```bash
npx tsx src/index.ts start
```

Bot 开始监听微信消息，所有收到的文字消息将由 Claude 自动回复。

## CLI 命令

| 命令 | 说明 |
|------|------|
| `login` | 扫码登录微信 Bot |
| `start [--account <id>]` | 启动消息监听（默认第一个账号） |
| `accounts` | 列出已登录的微信 Bot 账号 |
| `logout --account <id>` | 移除指定账号 |
| `status` | 显示运行状态 |

## Slash 命令（在微信中发送）

| 命令 | 说明 |
|------|------|
| `/help` | 显示可用命令 |
| `/reset` | 重置当前对话 |
| `/status` | 查看模型、对话条数、Token 用量 |
| `/model <名称>` | 切换 Claude 模型（如 `claude-opus-4-20250514`） |

## 配置参考

创建 `data/config.json`（所有字段可选，不配置则使用默认值）：

```json
{
  "claude": {
    "apiKey": "$CLAUDE_API_KEY",
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 4096,
    "temperature": 0.7
  },
  "weixin": {
    "dataDir": "./data",
    "botAgent": "ClaudeWeixinConnect/1.0",
    "defaultApiBaseUrl": "https://ilinkai.weixin.qq.com",
    "defaultCdnBaseUrl": "https://novac2c.cdn.weixin.qq.com/c2c"
  },
  "conversation": {
    "maxHistoryMessages": 20,
    "maxContextTokens": 50000
  },
  "allowedUsers": [],
  "systemPromptFile": "system-prompt.md"
}
```

- `claude.apiKey` — 支持 `${CLAUDE_API_KEY}` 环境变量替换
- `allowedUsers` — 白名单，空数组 = 允许所有人
- `systemPromptFile` — 自定义 System Prompt 文件路径（相对于 `dataDir`）

## 目录结构

```
data/                          # 运行时数据（自动创建）
  config.json                  # 配置文件（可选）
  accounts.json                # 账号索引
  accounts/{id}.json           # Bot 凭证（token, baseUrl, userId）
  accounts/{id}.sync.json      # 消息同步游标
  accounts/{id}.context-tokens.json  # 用户上下文 Token
  conversations/{acc}/{uid}.json  # 每用户对话历史
  tmp/                         # 临时媒体文件
  bridge-YYYY-MM-DD.log        # 日志文件

src/
  index.ts                     # CLI 入口
  config.ts                    # 配置系统（Zod 校验 + ENV 替换）
  storage.ts                   # 持久化层
  claude.ts                    # Claude API 流式封装
  bot.ts                       # 主循环（长轮询 + AI 回复）
  weixin/                      # 微信 iLink 协议层
    api/     types.ts, api.ts, config-cache.ts, session-guard.ts
    auth/    login-qr.ts
    cdn/     aes-ecb.ts, cdn-url.ts, cdn-upload.ts, pic-decrypt.ts, upload.ts
    messaging/ send.ts, send-media.ts, markdown-filter.ts
    media/   mime.ts, media-download.ts, silk-transcode.ts
    util/    logger.ts, random.ts, redact.ts
```

## 架构

```
微信用户 ──[消息]──> 微信 iLink Server
                         │
                    getUpdates (HTTP 长轮询)
                         │
                    ┌─────▼──────┐
                    │   bot.ts   │
                    │  长轮询循环  │
                    └─────┬──────┘
                          │
              提取文本/下载图片(CDN)
                          │
                    ┌─────▼──────┐
                    │  claude.ts │
                    │ Claude API │
                    └─────┬──────┘
                          │
                   流式回复 + Markdown 过滤
                          │
                    sendMessage (HTTP)
                          │
                    微信 iLink Server ──> 微信用户
```

## 技术栈

- **Runtime:** Node.js >= 22, TypeScript (ESM)
- **AI:** `@anthropic-ai/sdk` — Claude API (streaming + vision)
- **协议:** 微信 iLink Bot HTTP API（源自 `@tencent-weixin/openclaw-weixin`）
- **加密:** AES-128-ECB（CDN 媒体传输）
- **校验:** Zod（配置 schema）
- **依赖:** qrcode-terminal（扫码登录）, silk-wasm（语音转码，可选）

## 开发

```bash
npm run typecheck      # TypeScript 类型检查
npm run build          # 编译到 dist/
npm test               # 运行测试 (vitest)
```

## License

MIT
