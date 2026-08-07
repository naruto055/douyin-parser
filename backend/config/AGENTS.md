# AGENTS.md

本文件适用于 `backend/config/`，聚焦运行配置读取与默认值。

本文中跨模块引用使用仓库根路径，例如 `backend/tests/...`。

## 1. 模块职责

- `index.js`：集中读取环境变量并导出服务端口、限流、缓存、AI Provider、模型和超时等配置。

## 2. 设计约束

- 新增配置项必须有清晰默认值或明确的必填校验策略。
- 不在业务模块中散落读取 `process.env`，优先通过 `config/` 统一出口。
- 不修改真实密钥；涉及示例配置时只更新 `.env.example` 或文档中的占位值。
- 配置命名需与 README、`backend/docs/API.md` 中的说明保持一致。

## 3. 测试建议

- AI 配置变化：关注 `backend/tests/llmClientFactory.test.js`、`backend/tests/langChainProvider.test.js`。
- 限流或缓存配置变化：关注对应路由和服务测试。
