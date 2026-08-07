# AGENTS.md

本文件适用于 `backend/utils/`，聚焦通用工具与基础设施辅助函数。

本文中跨模块引用使用仓库根路径，例如 `backend/tests/...`。

## 1. 模块职责

- `response.js`：普通 JSON 响应格式。
- `sse.js`、`streamUtil.js`：SSE 与流处理辅助。
- `urlValidator.js`、`stringUtil.js`：输入字符串与 URL 处理。
- `cache.js`：解析结果缓存。
- `browserPool.js`、`douyinParser.js`、`thirdPartyAPI.js`：抖音解析基础能力与降级依赖。
- `audioExtractor.js`：音频提取与 ffmpeg 集成。

## 2. 设计约束

- `utils/` 只放跨模块复用的能力，不承载单一业务场景的私有逻辑。
- 新增工具函数前先检查是否已有同类函数，避免重复实现。
- 工具层尽量保持输入输出明确，不隐式读取 HTTP 上下文。
- 涉及文件、浏览器、网络、ffmpeg 的工具要保持错误语义清晰，便于服务层转换为业务错误。

## 3. 测试建议

- 通用工具：关注 `backend/tests/utils.test.js`。
- 响应封装：关注 `backend/tests/response.test.js`。
- SSE 辅助：关注 `backend/tests/sse.test.js`。
- 下载或媒体处理联动：同时关注 `backend/tests/downloadService.test.js`。
