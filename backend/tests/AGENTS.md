# AGENTS.md

本文件适用于 `backend/tests/`，聚焦测试组织与验证策略。

本文中本模块文件使用相对当前目录的写法。

## 1. 测试基线

- 测试运行命令在 `backend/` 目录执行：`pnpm test`。
- 当前使用 Node.js 原生测试运行器，脚本为 `node --test --experimental-test-isolation=none "tests/**/*.test.js"`。
- 测试文件按模块或行为命名，优先覆盖外部可观察行为。

## 2. 编写约束

- 修改路由时优先补路由测试，必要时 mock 服务边界。
- 修改服务时优先补服务测试，避免依赖真实网络、真实浏览器或真实模型调用。
- 修改 AI 流式行为时要覆盖事件顺序和关键事件负载。
- 测试夹具保持局部、清晰，不引入大型通用测试框架。

## 3. 常见映射

- `apiRoute.test.js`：解析、下载、健康检查等普通接口。
- `aiRoute.test.js`、`aiRoute.stream.test.js`：AI 普通与 SSE 路由。
- `aiChatService*.test.js`、`aiApplicationServices.test.js`：AI 服务编排与兼容入口。
- `createChatRuntime.test.js`、`langChainProvider.test.js`、`llmClientFactory.test.js`：AI 运行时与模型接入。
- `utils.test.js`、`response.test.js`、`sse.test.js`：基础工具与响应封装。
