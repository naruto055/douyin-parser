# 抖音音频解析工具

一个基于 Node.js 的抖音视频/音频解析下载工具，现已内置 AI 对话解析能力。

## 特性

- 🎵 **音频优先**：优先提供音频下载，节省流量
- 🎬 **视频下载**：按需提供无水印视频下载
- 🚀 **高性能**：浏览器池复用，减少启动开销
- 🛡️ **高可用**：主 Puppeteer 解析 + 第三方 API 自动降级
- 🤖 **AI 对话解析**：支持自然语言触发抖音解析
- 🔌 **多模型兼容**：支持 OpenAI 官方与 OpenAI 兼容接口模型
- 💻 **最小前端入口**：后端内置静态联调页面

## 技术栈

### 后端
- Node.js 18+
- Express 4.x
- puppeteer + puppeteer-cluster + stealth-plugin
- fluent-ffmpeg + ffmpeg-static
- PM2 (进程管理)

### AI 能力
- OpenAI Node SDK
- OpenAI 兼容 `chat.completions`
- Zod 参数校验

## 文档

- [技术方案详解](./docs/技术方案.md)

## 快速开始

### 环境要求

- Node.js 18+
- 至少 2GB 可用内存
- 10GB 可用磁盘空间

### 安装部署

详细部署说明请参考 [技术方案文档](./docs/技术方案.md#五服务器部署方案)

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

- 静态联调页：`http://localhost:3000/`
- AI 对话接口：`POST /api/ai/chat`

## 项目结构

```
douyin-parser/
├── backend/                # 后端服务与静态联调页
├── docs/                   # 设计文档
├── .zcf/plan/current/      # 当前实施计划
└── README.md
```

## 免责声明

本工具仅供学习和技术研究使用，下载的内容版权归原作者所有。请勿将下载的内容用于商业用途，使用本工具产生的一切法律责任由使用者自行承担。

## License

MIT
