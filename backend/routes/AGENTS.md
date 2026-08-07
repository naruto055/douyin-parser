# AGENTS.md

本文件适用于 `backend/routes/`，聚焦 HTTP 路由层职责。

本文中跨模块引用使用仓库根路径，例如 `backend/tests/...`。

## 1. 职责边界

- 路由层只负责参数读取、基础校验、调用服务、返回响应。
- 业务编排放入 `backend/services/` 或 `backend/ai/application/`，不要在路由回调中堆积解析、下载或模型调用细节。
- 普通 JSON 响应统一使用 `backend/utils/response.js`。
- 业务可预期异常优先抛出 `backend/errors/AppError.js`，错误码从 `backend/errors/errorCodes.js` 引用。

## 2. 接口约束

- `/api/parse`、`/api/download`、`/api/ai/chat`、`/api/ai/chat/stream` 的请求/响应结构变化必须同步 `backend/docs/API.md`。
- 文件下载成功响应返回文件流，不强制包装 JSON。
- SSE 建立后通过事件表达状态；SSE 初始化前的参数错误可以返回统一 JSON。
- 新增路由时确认是否需要限流，并复用现有中间件模式。

## 3. 测试建议

- 普通解析与下载路由：关注 `backend/tests/apiRoute.test.js`。
- AI 普通路由：关注 `backend/tests/aiRoute.test.js`。
- AI 流式路由：关注 `backend/tests/aiRoute.stream.test.js`。
- 响应结构或错误语义变化：同时关注 `backend/tests/response.test.js` 与相关服务测试。
