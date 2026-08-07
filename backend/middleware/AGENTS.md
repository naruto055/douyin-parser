# AGENTS.md

本文件适用于 `backend/middleware/`，聚焦横切中间件。

本文中跨模块引用使用仓库根路径，例如 `backend/tests/...`。

## 1. 模块职责

- `errorHandler.js`：统一异常转换，区分业务异常、参数/限流等非业务异常和未知系统异常。
- `rateLimit.js`：接口限流策略，区分普通接口与 AI 接口。

## 2. 设计约束

- 中间件只处理横切关注点，不放具体业务流程。
- 错误响应结构必须与 `backend/utils/response.js`、`backend/errors/errorCodes.js` 和 `backend/docs/API.md` 保持一致。
- 新增限流策略时明确作用范围，避免影响健康检查、下载流或 SSE 行为。

## 3. 测试建议

- 错误响应变化：关注 `backend/tests/apiRoute.test.js`、`backend/tests/aiRoute.test.js`、`backend/tests/response.test.js`。
- SSE 错误变化：关注 `backend/tests/aiRoute.stream.test.js`。
