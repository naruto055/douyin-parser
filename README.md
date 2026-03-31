# 抖音音频解析工具

一个基于 Node.js + Vue.js 的抖音视频/音频解析下载工具。

## 特性

- 🎵 **音频优先**：优先提供音频下载，节省流量
- 🎬 **视频下载**：按需提供无水印视频下载
- 🚀 **高性能**：浏览器池复用，减少启动开销
- 🛡️ **高可用**：主 Puppeteer 解析 + 第三方 API 自动降级
- 💻 **友好界面**：Vue 3 + Element Plus，简洁易用

## 技术栈

### 后端
- Node.js 18+
- Express 4.x
- puppeteer + puppeteer-cluster + stealth-plugin
- fluent-ffmpeg + ffmpeg-static
- PM2 (进程管理)

### 前端
- Vue 3 (Composition API)
- Vite
- Element Plus

## 文档

- [技术方案详解](./docs/技术方案.md)

## 快速开始

### 环境要求

- Node.js 18+
- 至少 2GB 可用内存
- 10GB 可用磁盘空间

### 安装部署

详细部署说明请参考 [技术方案文档](./docs/技术方案.md#五服务器部署方案)

## 项目结构

```
douyin-parser/
├── backend/          # 后端服务
├── frontend/         # 前端页面
├── docs/             # 文档
└── README.md
```

## 免责声明

本工具仅供学习和技术研究使用，下载的内容版权归原作者所有。请勿将下载的内容用于商业用途，使用本工具产生的一切法律责任由使用者自行承担。

## License

MIT
