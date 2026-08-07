# AGENTS.md

本文件适用于 `backend/ai/` 及其子目录，聚焦 AI 对话、工具调用、流式事件和模型接入边界。

本文中本模块子目录使用相对当前目录的写法；跨模块引用使用仓库根路径，例如 `backend/tests/...`。

## 1. 模块职责

- `application/`：AI 用例编排层，负责普通对话和流式对话的应用服务，不直接处理 Express 请求/响应对象。
- `runtime/`：模型消息归一化、工具调用轮次、流式事件适配和运行时创建逻辑。
- `infra/`：外部模型与 LangChain 适配层，隔离具体 SDK、Provider 和工具适配细节。
- `sessions/`：AI 会话存储与上下文裁剪。
- `tools/`：AI 可调用工具注册入口，工具实现优先复用 `backend/services/tools/`。
- `prompts/`：系统提示词与模型行为约束。

## 2. 边界约束

- 不在 `ai/` 内直接构造 HTTP 响应；HTTP 状态、SSE 初始化和 JSON 包装属于 `routes/` 与 `utils/`。
- 不在应用服务中硬编码 Provider 细节；模型创建和 LangChain 适配放在 `infra/`。
- 不让提示词承载业务兜底逻辑；确定性的链接提取、工具执行和状态判断应保留在代码中。
- 不将抖音解析实现复制到 AI 工具内；AI 工具应复用已有解析服务或工具封装。

## 3. 流式与兼容性

- `POST /api/ai/chat` 与 `POST /api/ai/chat/stream` 的外部契约优先保持稳定。
- 流式事件新增字段时，应保持旧字段可用，并同步更新 `backend/docs/API.md` 与相关测试。
- SSE 事件必须能表达 `session`、`progress`、`tool_result`、`done`、`error` 等关键阶段，不要把业务错误吞成普通文本。
- 会话相关变更需要关注普通与流式两条链路的一致性。

## 4. 测试建议

- 修改运行时：关注 `backend/tests/createChatRuntime.test.js`、`backend/tests/langChainProvider.test.js`、`backend/tests/llmClientFactory.test.js`。
- 修改工具注册或工具行为：关注 `backend/tests/aiToolRegistry.test.js`、`backend/tests/parseDouyinVideoTool.test.js`。
- 修改应用服务或兼容入口：关注 `backend/tests/aiApplicationServices.test.js`、`backend/tests/aiChatService.test.js`、`backend/tests/aiChatService.stream.test.js`。
- 修改路由流式行为：同时关注 `backend/tests/aiRoute.test.js` 与 `backend/tests/aiRoute.stream.test.js`。
