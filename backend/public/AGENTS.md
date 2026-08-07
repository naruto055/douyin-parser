# AGENTS.md

本文件适用于 `backend/public/`，聚焦后端内置静态联调页面。

本文中本模块文件使用相对当前目录的写法；跨模块引用使用仓库根路径，例如 `backend/tests/...`。

## 1. 模块职责

- `index.html`：本地联调用页面入口。
- `chatApi.js`：普通 AI 对话接口联调脚本。
- `chatDiagnostics.js`：AI 诊断与流式链路调试脚本。

## 2. 设计约束

- `public/` 定位为后端联调控制台，不是正式业务前端。
- 修改页面交互时保持轻量直接，不引入构建链路或大型前端框架。
- 如果接口字段、SSE 事件或错误结构变化影响联调页面，应同步更新相关脚本。
- 不在静态页面中写入真实 API Key 或其他敏感配置。

## 3. 验证建议

- 涉及 AI 普通接口：配合 `backend/tests/aiRoute.test.js` 验证接口契约。
- 涉及 SSE 行为：配合 `backend/tests/aiRoute.stream.test.js` 验证事件结构。
- 页面展示类改动需手工打开本地服务检查基本交互。
