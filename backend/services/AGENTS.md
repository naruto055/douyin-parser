# AGENTS.md

本文件适用于 `backend/services/`，聚焦业务编排层与服务边界。

本文中本模块子目录使用相对当前目录的写法；跨模块引用使用仓库根路径，例如 `backend/tests/...`。

## 1. 模块职责

- `VideoService.js`：抖音链接解析业务入口，协调主解析链路与降级链路。
- `DownloadService.js`：视频/音频下载编排，处理缓存、文件名、媒体类型和音频提取。
- `AIChatService.js`：AI 对话兼容入口，当前仍承担部分编排与兜底逻辑，并逐步桥接新的 `backend/ai/` 应用服务。
- `tools/`：供 AI 调用的业务工具封装，避免直接暴露底层工具细节。

## 2. 设计约束

- 服务层可以编排多个工具或基础设施，但不要依赖 Express 的 `req`、`res` 对象。
- 下载与解析逻辑应复用 `backend/utils/` 中已有缓存、URL 校验、音频处理和浏览器池能力。
- `AIChatService.js` 保持兼容入口与过渡职责；新增 AI 核心逻辑优先放入 `backend/ai/`。
- 业务失败使用 `AppError` 表达，不在服务层返回多套错误结构。

## 3. 测试建议

- 视频解析：关注 `backend/tests/videoService.test.js`。
- 下载逻辑：关注 `backend/tests/downloadService.test.js`。
- AI 兼容入口：关注 `backend/tests/aiChatService.test.js` 与 `backend/tests/aiChatService.stream.test.js`。
- AI 工具封装：关注 `backend/tests/parseDouyinVideoTool.test.js`。
