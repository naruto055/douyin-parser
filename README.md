# 抖音解析工具

一个基于 Node.js 的抖音视频/音频解析与下载工具，当前已内置 AI 对话解析、流式 SSE 对话接口，以及后端内置的联调控制台。

## 特性

- 🎵 **音频优先**：优先提供音频下载，节省流量
- 🎬 **视频下载**：按需提供无水印视频下载
- 🚀 **高性能**：浏览器池复用，减少启动开销
- 🛡️ **高可用**：主 Puppeteer 解析 + 第三方 API 自动降级
- 🤖 **AI 对话解析**：支持自然语言触发抖音解析
- 🌊 **流式响应**：支持 SSE 流式返回思考、进度、工具结果与最终答复
- 🔌 **OpenAI 兼容模型接入**：支持通过 OpenAI 兼容协议接入 OpenAI 官方或兼容服务
- 💻 **联调控制台**：后端内置静态页面，可直接验证普通对话、函数调用与流式链路

## 技术栈

### 后端
- Node.js 18+
- Express 4.x
- puppeteer + puppeteer-cluster + puppeteer-extra-plugin-stealth
- fluent-ffmpeg + ffmpeg-static
- axios + express-rate-limit

### AI 能力
- LangChain `ChatOpenAI`
- OpenAI Node SDK
- OpenAI 兼容接口
- Zod 参数校验

## 文档

- [技术方案详解](./docs/技术方案.md)
- [后端 API 文档](./backend/docs/API.md)

## 快速开始

### 环境要求

- Node.js 18+
- 至少 2GB 可用内存
- 10GB 可用磁盘空间

### 安装部署

详细部署说明请参考 [技术方案文档](./docs/技术方案.md#五服务器部署方案)。

本地启动最小步骤：

```bash
cd backend
pnpm install
pnpm start
```

开发调试也可使用：

```bash
cd backend
pnpm dev
```

### AI 对话配置

复制 [backend/.env.example](./backend/.env.example) 到 `backend/.env` 后，按需填写：

```bash
AI_CHAT_ENABLED=true
LLM_PROVIDER=openai-compatible
LLM_API_KEY=你的密钥
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4.1-mini
```

兼容示例：

- OpenAI：`https://api.openai.com/v1`
- DeepSeek：`https://api.deepseek.com`
- 通义千问 / 百炼：`https://dashscope.aliyuncs.com/compatible-mode/v1`

启动后可访问：

- 健康检查：`GET /api/health`
- 解析接口：`POST /api/parse`
- 下载接口：`GET /api/download?type=video|audio&url=...`
- 静态联调页：`http://localhost:3000/`
- AI 对话接口：`POST /api/ai/chat`
- AI 流式接口：`POST /api/ai/chat/stream`

## 当前实现说明

- 抖音解析主链路为 Puppeteer，失败后自动回退第三方解析接口。
- 下载接口只接受抖音页面链接，不接受直接媒体文件链接。
- 音频下载会优先使用解析结果中的音频直链；若无可用音频直链，则回退为从视频中提取音频。
- AI 对话支持普通 JSON 返回和 SSE 流式返回，两种接口都支持 `sessionId` 延续上下文。
- 当前 LLM Provider 实现聚焦 `openai-compatible` 协议，适合接 OpenAI 官方和兼容 OpenAI 接口的服务。
- 内置静态页面定位为联调控制台，不是正式业务前端。

## 项目结构

```
douyin-parser/
├── backend/                # 后端服务、AI 能力与静态联调页
├── docs/                   # 设计文档
├── AGENTS.md               # 仓库协作约束
├── .zcf/plan/current/      # 当前实施计划
└── README.md
```

## 免责声明

本工具仅供学习和技术研究使用，下载的内容版权归原作者所有。请勿将下载的内容用于商业用途，使用本工具产生的一切法律责任由使用者自行承担。

## License

MIT
