# Claude Weixin Connect

将 AI 大模型接入微信的独立桥接程序。基于微信官方 ClawBot（iLink Bot）协议，**无需 OpenClaw 框架**，直接连接 AI API。

支持 **DeepSeek** 和 **Claude** 两种 AI 后端。

## 它能做什么

- 用微信给 Bot 发消息，AI 自动回复
- 支持流式输出 + "正在输入"状态
- 对话上下文记忆（滑动窗口 + Token 限制）
- 内置 Slash 命令（/reset 重置对话、/status 查看状态、/model 切换模型）
- 多 Bot 账号管理

## 限制

| 能力 | 状态 | 说明 |
|------|------|------|
| 文字聊天 | ✅ | 完整支持 |
| 图片识别 | ⚠️ | Claude 支持；DeepSeek API 不支持 |
| 语音消息 | ❌ | 未实现 |
| 文件/视频 | ❌ | 未实现 |
| 出站图片 | ❌ | AI 无法主动发图片 |
| 群聊 | ❌ | 仅私聊 |

> **图片识别说明**：DeepSeek 网页端有"识图模式"，但其 **API 是纯文本的**，不支持 `image_url` 内容块。如需图片识别，请使用 Claude API（`provider: "anthropic"`）。

## 快速开始

### 前提条件

- **Node.js** ≥ 22
- **微信** iOS 版 ≥ 8.0.70（用于扫码授权 Bot）
- **AI API Key**（二选一）：
  - DeepSeek：[platform.deepseek.com](https://platform.deepseek.com/) → API Keys
  - Claude：[console.anthropic.com](https://console.anthropic.com/settings/keys)

### 1. 克隆并安装

```bash
git clone https://github.com/Qianmaidou/Claude-weixin-connect.git
cd Claude-weixin-connect
npm install
```

### 2. 配置 API Key

**方式一：DeepSeek**

```bash
# 创建 .env
echo DEEPSEEK_API_KEY=sk-你的密钥 > .env
```

项目自带 `data/config.json` 已预配置好 DeepSeek，无需额外操作。

**方式二：Claude**

```bash
# 创建 .env
echo CLAUDE_API_KEY=sk-ant-你的密钥 > .env
```

然后修改 `data/config.json`：

```json
{
  "ai": {
    "provider": "anthropic",
    "apiKey": "$CLAUDE_API_KEY",
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 4096,
    "temperature": 0.7
  }
}
```

### 3. 扫码登录

```bash
npx tsx src/index.ts login
```

终端显示二维码 → 用 **iOS 微信** 扫描 → 手机上确认授权 → 完成。

### 4. 启动

```bash
npx tsx src/index.ts start
```

看到 `✅ 长轮询已启动，等待新消息...` 就去微信给 Bot 发消息。

> 按 `Ctrl+C` 停止。程序停止后 Bot 不回复，下次启动会拉取离线消息。

## 使用指南

### CLI 命令

| 命令 | 说明 |
|------|------|
| `npx tsx src/index.ts login` | 扫码登录微信 Bot |
| `npx tsx src/index.ts start` | 启动消息监听 |
| `npx tsx src/index.ts start --account <id>` | 指定账号启动 |
| `npx tsx src/index.ts accounts` | 列出已登录账号 |
| `npx tsx src/index.ts logout --account <id>` | 移除账号 |
| `npx tsx src/index.ts status` | 显示运行状态 |

### 微信内 Slash 命令

在微信聊天框中发送：

| 命令 | 说明 |
|------|------|
| `/help` | 显示可用命令 |
| `/reset` | 重置当前对话（清空上下文） |
| `/status` | 查看模型、对话条数、Token 用量 |
| `/model 模型名` | 切换 AI 模型 |

### 配置文件

完整配置项见 `data/config.json`（所有字段均可选）：

```json
{
  "ai": {
    "provider": "anthropic",
    "apiKey": "$CLAUDE_API_KEY",
    "baseURL": "https://api.deepseek.com/v1",
    "model": "deepseek-v4-pro",
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

| 字段 | 说明 |
|------|------|
| `ai.provider` | `"anthropic"` 或 `"openai-compatible"` |
| `ai.apiKey` | 支持 `$ENV_VAR` 格式引用环境变量 |
| `ai.baseURL` | OpenAI 兼容 API 地址（DeepSeek：`https://api.deepseek.com/v1`） |
| `ai.model` | 模型名（Claude：`claude-sonnet-4-20250514`；DeepSeek：`deepseek-v4-pro`） |
| `allowedUsers` | 用户白名单，空数组 = 所有人可聊 |
| `systemPromptFile` | 自定义 System Prompt 文件路径 |

### 自定义 System Prompt

创建 `data/system-prompt.md`：

```markdown
你是一个微信助手，用简洁友好的语气回复。
```

不创建则使用内置默认 Prompt。

## 目录结构

```
Claude-weixin-connect/
  .env                          # API Key（不提交 Git）
  .env.example                  # 环境变量模板
  config.example.json           # 配置模板
  system-prompt.example.md      # System Prompt 模板
  data/                         # 运行时数据（自动创建）
    config.json                 # 配置文件
    accounts.json               # 账号索引
    accounts/{id}.json          # Bot 凭证
    accounts/{id}.sync.json     # 消息同步游标
    conversations/{acc}/{uid}.json  # 对话历史
    tmp/                        # 临时媒体文件
  src/
    index.ts                    # CLI 入口
    config.ts                   # 配置系统（Zod + .env 加载）
    storage.ts                  # 持久化层
    claude.ts                   # AI 层（Anthropic + OpenAI 兼容）
    bot.ts                      # 主循环（长轮询 + 消息处理 + 回复）
    vendor.d.ts                 # 类型声明
    weixin/                     # 微信 iLink 协议层
      api/      types.ts, api.ts, config-cache.ts, session-guard.ts
      auth/     login-qr.ts
      cdn/      aes-ecb.ts, cdn-url.ts, cdn-upload.ts, pic-decrypt.ts, upload.ts
      messaging/ send.ts, send-media.ts, markdown-filter.ts
      media/    mime.ts, media-download.ts, silk-transcode.ts
      util/     logger.ts, random.ts, redact.ts
```

## 架构

```
微信用户 ──→ 微信 iLink Server
                 │
            getUpdates (HTTP 长轮询, 35s timeout)
                 │
            ┌────▼────────┐
            │   bot.ts    │  消息处理 + 对话管理
            └────┬────────┘
                 │
          ┌──────▼──────┐
          │  claude.ts  │  Anthropic SDK / OpenAI SDK
          └──────┬──────┘
                 │
          DeepSeek / Claude API
                 │
            流式响应 + Markdown 过滤 → sendMessage → 微信
```

## 部署到服务器

程序跑在本地电脑上，关机就停。想 24 小时在线：

### 方法一：PM2（推荐）

```bash
npm install -g pm2
pm2 start npx --name "weixin-bot" -- tsx src/index.ts start
pm2 save
pm2 startup
```

### 方法二：systemd

```bash
sudo tee /etc/systemd/system/weixin-bot.service << 'EOF'
[Unit]
Description=Claude Weixin Connect
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/Claude-weixin-connect
ExecStart=/usr/bin/npx tsx src/index.ts start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now weixin-bot
```

> 部署前记得把 `.env` 和 `data/accounts/` 目录拷贝到服务器。

## 技术细节

### 协议

基于微信 iLink Bot HTTP API（ClawBot），提取自 `@tencent-weixin/openclaw-weixin`：

- **认证**：Bearer Token（扫码登录获取）
- **收消息**：`POST ilink/bot/getupdates`（长轮询，35s 超时，cursor 机制）
- **发消息**：`POST ilink/bot/sendmessage`（支持 TEXT, IMAGE, VIDEO, FILE, VOICE）
- **媒体**：CDN 传输，AES-128-ECB 加密
- **输入状态**：`POST ilink/bot/sendtyping`

### 依赖

| 包 | 用途 |
|----|------|
| `@anthropic-ai/sdk` | Claude API |
| `openai` | DeepSeek / OpenAI 兼容 API |
| `qrcode-terminal` | 终端显示二维码 |
| `zod` | 配置校验 |
| `silk-wasm` | 语音 SILK → WAV（可选） |

### 测试

```bash
npm test   # vitest，24 个测试
```

## 解决过的问题记录

| 问题 | 原因 | 解决 |
|------|------|------|
| `Config validation errors: claude: Required` | `.env` 未被加载 | 添加 `loadEnvFile()` 自动加载 `.env` |
| `key=$DEEPSEEK...` 未替换 | `$VAR` 格式不被 `resolveEnvVars` 识别 | 正则增加 `$VAR` 格式支持 |
| `401 api key invalid` | 用户提供的 key 非有效 DeepSeek key | 重新创建有效 API Key |
| 纯图片消息无响应 | `extractText()` 返回空 → 提前 return | 跳过空文本检查（当有图片时） |
| DeepSeek 报 `unknown variant 'image_url'` | DeepSeek API 不支持图片 | 图片消息降级为文字提示 |
| 回复不发到微信 | `filter.flush()` 前未 feed 缓冲区 | 最终 flush 前先 feed 再 flush |

## License

MIT
