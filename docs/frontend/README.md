# 前端文档目录

本目录用于管理 `douyin-parser` 前端项目相关文档，前端计划、技术选型、页面方案和接口接入策略均放在这里，避免与 `backend/docs/` 的后端 API 契约文档混放。

## 文档边界

- `backend/docs/API.md`：后端接口契约来源，只记录后端 API 定义。
- `docs/frontend/`：前端项目规划、页面设计、接口消费方式和实施步骤。
- `frontend/`：后续前端项目源码目录，不在本文档阶段创建业务代码。

## 文档清单

- [技术选型](./TECH_STACK.md)：UniApp、Vue3、TypeScript、UI 与样式方案。
- [实施计划](./IMPLEMENTATION_PLAN.md)：前端项目从骨架到接口联调的分阶段计划。
- [接口接入方案](./API_INTEGRATION_PLAN.md)：基于后端 API 文档的前端接口分层与接入规则。
- [实施状态](./IMPLEMENTATION_STATUS.md)：当前已完成内容、未验证项和下一步。

## 当前决策

- 前端采用 `uni-app + Vue 3 + TypeScript`。
- 首阶段先搭建前端骨架和响应式页面框架。
- AI 相关接口暂不接入，只保留后续扩展位置。
- 接口契约以 `backend/docs/API.md` 为准，前端文档不重复维护完整 API 定义。
