# 抖音解析 AI 链路迁移到 LangChain.js 实施计划

> **For agentic workers:** 本计划用于指导将当前仓库中的 AI 相关能力从“OpenAI SDK + 手写工具调度”重构为“LangChain.js/LangGraph 驱动的 AI 运行时”。本阶段仅输出实施计划，不修改业务代码。执行阶段应优先采用小步提交，确保每一步都可回滚、可测试、可独立验收。

**Goal:** 在不破坏现有 `POST /api/ai/chat` 与 `POST /api/ai/chat/stream` 对外契约的前提下，将当前 AI 编排、工具调用和模型适配逻辑迁移到 `LangChain.js` 体系，并为后续迁移到 `NestJS` 保留清晰的模块边界、依赖注入边界与工具注册边界。

**Architecture:** 采用“先抽象边界，再替换运行时，最后清理旧实现”的渐进式重构方案。短期保持 Express 路由层、现有 `VideoService` 业务层和 SSE 事件契约不变；中期引入 `LangChain.js` tools、chat model adapter、agent/runtime；长期可将 AI 模块平滑迁移到 `NestJS` 的 provider/module 结构中，而无需再次重写工具与业务服务。

**Tech Stack:** Node.js 18+、Express、LangChain.js、LangGraph（按需引入）、Zod、现有 OpenAI-compatible 模型服务、`node:test`

---

## 1. 现状分析

### 1.1 当前已存在的 AI 相关代码边界

- `backend/services/AIChatService.js`
  - 承担 AI 会话编排入口
  - 负责会话历史存储、system prompt 组织、工具调用循环、SSE 流式拆分、降级路径、结果归一化
- `backend/services/llm/LLMClientFactory.js`
  - 根据配置返回当前模型提供方实例
- `backend/services/llm/OpenAICompatibleProvider.js`
  - 封装 OpenAI-compatible 请求
  - 提供 `generate()` / `streamGenerate()`
  - 负责将上游 `tool_calls` 归一化为内部 `toolCalls`
- `backend/services/tools/parseDouyinVideoTool.js`
  - 以“工具定义 + 入参校验 + execute”形式暴露抖音解析能力
- `backend/services/VideoService.js`
  - 实际承载抖音解析业务逻辑
- 测试覆盖
  - `backend/tests/aiChatService.test.js`
  - `backend/tests/aiChatService.stream.test.js`
  - `backend/tests/openAICompatibleProvider.test.js`
  - `backend/tests/parseDouyinVideoTool.test.js`
  - `backend/tests/aiRoute*.test.js`

### 1.2 当前实现的优点

- 已有明确的工具文件边界，`parseDouyinVideoTool` 可以直接映射到 LangChain tool
- 已有 `Zod` 依赖，适合继续作为工具输入 schema
- `VideoService` 与工具层相对解耦，业务逻辑不依赖 OpenAI SDK
- 路由层未与 provider 深度耦合，便于替换 AI 编排实现
- 已有非流式与流式测试，具备重构回归基础

### 1.3 当前实现的主要问题

- `AIChatService` 角色过重，违反单一职责
  - 同时承担会话管理、协议适配、工具执行、流式内容清洗、业务降级
- Tool Calling 调度是手写实现
  - `_executeToolCalls()` 通过工具名匹配本地工具
  - 二次拼装 `assistant/tool` message 再请求模型
- Provider 层维护协议细节
  - `OpenAICompatibleProvider` 需要了解 `tool_calls`、流式 chunk 结构
- 流式与非流式编排分叉
  - `chat()` 与 `chatStream()` 共享少，但仍存在双路径维护成本
- 当前目录结构偏“按技术细节散落”
  - `services/llm`
  - `services/tools`
  - `services/AIChatService`
  - 不利于未来迁移到 `NestJS module/provider` 组织方式

### 1.4 当前实现中的可保留资产

- `SYSTEM_PROMPT` 与业务限制语义
- `extractUrlFromText()` 等抖音输入预处理能力
- `parseDouyinVideoTool` 的输入输出语义
- `VideoService.parseVideo()` 业务服务
- SSE 事件契约与前端消费方式
- 会话历史存储语义
- 现有测试样例和 mock 策略

---

## 2. 重构目标

### 2.1 功能目标

- 保持以下接口行为稳定：
  - `POST /api/ai/chat`
  - `POST /api/ai/chat/stream`
- 保持以下语义稳定：
  - 可解析抖音分享链接或文案
  - 可输出 `thinking/reply/parsedData/toolStatus`
  - 工具执行仍在 Node.js 服务端完成，不在模型侧执行
- 迁移后由 LangChain 负责：
  - 工具定义与注册
  - 模型工具调用循环
  - 模型消息抽象
  - 运行时编排

### 2.2 架构目标

- 将 AI 能力拆分为明确的层次：
  - 路由层
  - AI 应用服务层
  - Agent/runtime 层
  - Tool registry 层
  - 业务服务层
  - Provider/Model adapter 层
- 保证未来迁移到 `NestJS` 时：
  - Tool 可以迁移为 provider
  - Agent/runtime 可以迁移为 module 内部 service
  - 业务服务不依赖具体 AI 框架
  - HTTP 层与 AI runtime 解耦

### 2.3 非目标

- 本次不引入复杂多代理协作
- 本次不引入向量数据库、RAG、长期记忆
- 本次不重写 `VideoService` 核心业务逻辑
- 本次不切换 Express 到 NestJS
- 本次不改变前端调用协议

---

## 3. 目标架构设计

### 3.1 建议的目标目录结构

```text
backend/
  ai/
    application/
      AIChatAppService.js
      AIStreamAppService.js
    runtime/
      createChatRuntime.js
      messageNormalizer.js
      streamEventAdapter.js
      toolCallingConfig.js
    tools/
      parseDouyinVideoTool.js
      index.js
    sessions/
      AISessionStore.js
    prompts/
      systemPrompt.js
    contracts/
      AIChatResult.js
      AIStreamEvent.js
    infra/
      model/
        createChatModel.js
      langchain/
        langChainToolAdapterFactory.js
        outputParser.js
  services/
    VideoService.js
  routes/
    ai.js
```

### 3.2 目录设计说明

- `ai/application`
  - 面向路由层的应用服务
  - 对外暴露 `chat()` / `chatStream()`
  - 不直接关心 OpenAI SDK 协议细节
- `ai/runtime`
  - 放置 LangChain agent、graph、消息处理、运行时编排逻辑
- `ai/tools`
  - 放置 LangChain tool 定义
  - 保持“薄工具层”
- `ai/sessions`
  - 隔离会话存储，未来可切换 Redis/DB
- `ai/prompts`
  - 提取系统提示词，避免散落在 service 中
- `ai/contracts`
  - 统一应用层返回结构与流式事件结构
- `ai/infra/model`
  - 模型适配层，只负责根据配置创建 LangChain chat model

### 3.3 面向未来 NestJS 的接口边界

- `AIChatAppService`
  - 未来对应 `AiChatService` provider
- `AISessionStore`
  - 未来对应 `AiSessionStore` provider
- `createChatRuntime()`
  - 未来对应 `AiRuntimeFactory` provider
- `parseDouyinVideoTool`
  - 未来可以封装为 `@Injectable()` 的 tool provider
- `VideoService`
  - 保持业务服务身份，不绑定 LangChain

---

## 4. 关键设计决策

### 4.1 选型结论

- 主体框架：`LangChain.js`
- 编排能力：优先 `LangChain agents`
- 状态图能力：预留 `LangGraph`，但首阶段不强制引入复杂 graph

### 4.2 为什么不是直接全量上 LangGraph

- 当前只有 1 个核心工具，直接上复杂 graph 会增加认知成本
- 当前最需要解决的是“手写工具调用循环”与“Provider 协议耦合”
- 当工具数、审批流、状态节点明显增加后，再引入 LangGraph 更合理

### 4.3 为什么仍然保留“应用服务层”

- LangChain 不应直接暴露给路由层
- 应用服务层负责维持现有对外契约：
  - `thinking`
  - `reply`
  - `parsedData`
  - `toolStatus`
  - SSE 事件序列
- 这样未来替换 AI runtime、迁移 NestJS 时，Controller/Route 基本不动

### 4.4 工具执行原则

- 工具始终在 Node.js 服务端执行
- LangChain 只负责调度，不进入业务逻辑本身
- `VideoService.parseVideo()` 保持为业务执行核心

---

## 5. 分阶段实施步骤

## Phase 0：准备阶段

目标：
- 在不改行为的前提下，为 LangChain 迁移做边界清理

步骤：
- [ ] 梳理当前 AI 路由、服务、工具、测试依赖图
- [ ] 固化当前接口契约与事件契约
- [ ] 记录 `POST /api/ai/chat` 与 `POST /api/ai/chat/stream` 的基线样例
- [ ] 新增重构分支并约定提交拆分策略

产出：
- 契约快照
- 基线测试结果

验收：
- 当前所有 AI 相关测试全部通过
- 已记录可回归的输入输出样例

## Phase 1：抽离框架无关的应用边界

目标：
- 把 `AIChatService` 从“全能类”拆成多个稳定边界

步骤：
- [ ] 提取 `systemPrompt` 到 `backend/ai/prompts/systemPrompt.js`
- [ ] 提取会话管理逻辑到 `backend/ai/sessions/AISessionStore.js`
- [ ] 提取 `thinking/reply` 规范化逻辑到 `messageNormalizer.js`
- [ ] 提取 SSE 事件拼装逻辑到 `streamEventAdapter.js`
- [ ] 保留原 `AIChatService` 作为 façade，内部转调新应用服务

文件级改造：
- 调整 `backend/services/AIChatService.js`
- 新增 `backend/ai/prompts/systemPrompt.js`
- 新增 `backend/ai/sessions/AISessionStore.js`
- 新增 `backend/ai/runtime/messageNormalizer.js`
- 新增 `backend/ai/runtime/streamEventAdapter.js`

验收：
- 对外接口不变
- `aiChatService*.test.js` 行为不变

## Phase 2：建立 Tool Registry 与 LangChain Tool 适配层

目标：
- 将当前工具文件从“OpenAI tool 定义”迁移为“LangChain tool 定义”

步骤：
- [ ] 新增 `langChainToolAdapterFactory.js`，统一把 Zod schema 和 execute 逻辑包装为 LangChain tool 适配器
- [ ] 改造 `parseDouyinVideoTool.js`，输出 LangChain-compatible tool 对象
- [ ] 增加 `backend/ai/tools/index.js` 作为工具注册表
- [ ] 保留旧导出兼容层，避免一次性改动所有调用方

文件级改造：
- 调整 `backend/services/tools/parseDouyinVideoTool.js`
- 新增 `backend/ai/infra/langchain/langChainToolAdapterFactory.js`
- 新增 `backend/ai/tools/index.js`

验收：
- 工具输入校验仍由 Zod 承担
- 工具执行结果结构不变
- `parseDouyinVideoTool.test.js` 保持通过

## Phase 3：替换模型适配层

目标：
- 用 LangChain chat model 替换当前 `OpenAICompatibleProvider`

步骤：
- [ ] 新增 `createChatModel.js`，根据当前配置创建 LangChain chat model
- [ ] 将 `LLMClientFactory` 重构为 model factory 或 agent factory
- [ ] 保持 `config.ai.baseURL`、`apiKey`、`model`、`temperature`、`maxTokens` 兼容
- [ ] 删除业务层对 `tool_calls` 原始协议的感知

文件级改造：
- 调整 `backend/services/llm/LLMClientFactory.js`
- 废弃 `backend/services/llm/OpenAICompatibleProvider.js`
- 新增 `backend/ai/infra/model/createChatModel.js`

验收：
- 非流式 AI 调用可通过 LangChain 正常完成
- 原 `openAICompatibleProvider.test.js` 替换为新的 model factory 测试

## Phase 4：引入 LangChain Runtime

目标：
- 用 LangChain runtime 管理工具调用循环，移除 `_executeToolCalls()` 手写逻辑

步骤：
- [ ] 新增 `createChatRuntime.js`
- [ ] 将 `tools` 注册到 agent runtime
- [ ] 让 runtime 负责“模型决定调用工具 -> 工具执行 -> 结果回填 -> 再生成”
- [ ] 由应用层只接收最终结果和中间工具事件
- [ ] 保留“检测到明确抖音链接时的后端预解析降级路径”，但将其收敛到 runtime policy 中，而不是散落在 service 主流程中

文件级改造：
- 调整 `backend/services/AIChatService.js`
- 新增 `backend/ai/runtime/createChatRuntime.js`
- 新增 `backend/ai/runtime/toolCallingConfig.js`

验收：
- 删除 `AIChatService._executeToolCalls()` 后行为不回退
- 工具调用场景测试全部通过

## Phase 5：统一非流式与流式编排

目标：
- 让 `chat()` 与 `chatStream()` 共享 LangChain runtime，只保留结果输出方式差异

步骤：
- [ ] 将同步调用与流式调用收敛到统一 agent invocation 层
- [ ] 流式模式下仅负责把 LangChain 事件转为现有 SSE 事件
- [ ] 保持 `session/progress/tool_result/thinking_delta/reply_delta/done` 契约不变
- [ ] 清理当前对 `<minimax:tool_call>`、`<think>` 的兼容逻辑，区分“必须保留”与“供应商遗留适配”

文件级改造：
- 调整 `backend/services/AIChatService.js`
- 调整 `backend/utils/sse.js` 仅在事件输出层保留
- 完善 `backend/ai/runtime/streamEventAdapter.js`

验收：
- `aiChatService.stream.test.js`
- `aiRoute.stream.test.js`
- SSE 手工联调通过

## Phase 6：清理旧实现并稳定 API

目标：
- 删除迁移后不再需要的手写协议胶水

步骤：
- [ ] 删除旧 provider 兼容层
- [ ] 删除不再需要的 message/tool_calls 组装逻辑
- [ ] 清理冗余的 fallback 代码
- [ ] 更新 AI 文档和架构说明

验收：
- 代码路径清晰，无“双实现并存”状态
- 测试稳定通过
- 文档更新完成

---

## 6. 文件级改造清单

### 6.1 需要调整的现有文件

- `backend/services/AIChatService.js`
  - 由“全能编排类”收缩为 façade 或迁移为 `AIChatAppService`
- `backend/services/llm/LLMClientFactory.js`
  - 改为 LangChain model/agent factory
- `backend/services/llm/OpenAICompatibleProvider.js`
  - 逐步废弃
- `backend/services/tools/parseDouyinVideoTool.js`
  - 改造成 LangChain tool
- `backend/routes/ai.js`
  - 仅调整依赖注入点，不改变路由契约
- `backend/tests/aiChatService.test.js`
  - 调整 mock 对象，从 provider mock 转为 runtime/tool mock
- `backend/tests/aiChatService.stream.test.js`
  - 验证新的流式 runtime 输出
- `backend/tests/openAICompatibleProvider.test.js`
  - 删除或改写为 LangChain model factory 测试

### 6.2 建议新增的文件

- `backend/ai/application/AIChatAppService.js`
- `backend/ai/application/AIStreamAppService.js`
- `backend/ai/runtime/createChatRuntime.js`
- `backend/ai/runtime/messageNormalizer.js`
- `backend/ai/runtime/streamEventAdapter.js`
- `backend/ai/runtime/toolCallingConfig.js`
- `backend/ai/prompts/systemPrompt.js`
- `backend/ai/sessions/AISessionStore.js`
- `backend/ai/tools/index.js`
- `backend/ai/infra/model/createChatModel.js`
- `backend/ai/infra/langchain/langChainToolAdapterFactory.js`
- `backend/tests/aiLangChainIntegration.test.js`

### 6.3 可以保持不动或最小改动的文件

- `backend/services/VideoService.js`
- `backend/utils/douyinParser.js`
- `backend/utils/sse.js`
- 下载、音频提取、缓存、浏览器池等非 AI 核心基础能力

---

## 7. 面向 NestJS 的扩展性设计

### 7.1 当前阶段就应遵守的 Nest-friendly 原则

- 不让路由层直接依赖具体模型 SDK
- 不让工具层直接依赖 HTTP 请求对象
- 不让业务服务依赖 LangChain 的 message/tool 类型
- 将配置读取收敛在 factory 层
- 将会话存储抽象为独立 store

### 7.2 后续迁移到 NestJS 时的映射关系

- `backend/ai/application/AIChatAppService.js`
  - 对应 `AiChatService` provider
- `backend/ai/sessions/AISessionStore.js`
  - 对应 `AiSessionStore` provider
- `backend/ai/runtime/createChatRuntime.js`
  - 对应 `AiRuntimeFactory`
- `backend/ai/tools/*.js`
  - 对应一个或多个 tool provider
- `backend/services/VideoService.js`
  - 可直接迁为 `@Injectable()`

### 7.3 是否现在就做装饰器式工具注册

结论：
- 不建议本阶段先做 `@AiTool()` 装饰器

原因：
- 当前仅 1 个工具，过早做扫描式注册属于过度设计
- 先稳定 tool registry 接口，再根据 NestJS `DiscoveryService` 补一层装饰器更稳妥

---

## 8. 风险分析

### 8.1 主要风险

- LangChain 引入后，流式事件模型与当前 SSE 事件不完全一致
- 现有 `<think>` 内容拆分逻辑在新 runtime 下可能需要重写
- OpenAI-compatible 供应商与 LangChain provider 的兼容度需要实测
- 测试 mock 策略需从“mock provider”切换为“mock runtime/agent”
- 若一次性切换过多层次，容易出现灰度困难

### 8.2 风险应对

- 保持“外部 API 契约不动，内部实现逐步替换”
- 在迁移初期保留旧实现 behind feature flag
- 先完成非流式，再收口流式
- 对关键供应商兼容特性做契约测试
- 在 Phase 4 前不删除旧 provider

### 8.3 不建议的做法

- 不要一开始就把 Express + AI runtime + 路由 + 工具文件一起重写
- 不要在迁移首阶段引入 LangGraph 复杂状态图
- 不要让 LangChain 类型蔓延到 `VideoService` 业务层

---

## 9. 回滚策略

### 9.1 回滚原则

- 每个阶段独立提交
- 每次只替换一个架构层
- 允许旧实现并存直到新实现稳定

### 9.2 建议的回滚点

- 回滚点 1：仅完成目录抽离，不改变运行时
- 回滚点 2：工具已 LangChain 化，但仍走旧 AIChatService 主流程
- 回滚点 3：非流式切到 LangChain，流式仍走旧实现
- 回滚点 4：流式切换完成，旧 provider 尚未删除

### 9.3 Feature Flag 建议

- `AI_RUNTIME=legacy|langchain`
- `AI_STREAM_RUNTIME=legacy|langchain`

用途：
- 支持灰度切换
- 支持线上快速回退
- 支持对比同一输入下新旧实现行为差异

---

## 10. 测试计划

### 10.1 单元测试

- `langChainToolAdapterFactory` 输入校验与 execute 包装测试
- `AISessionStore` 会话裁剪测试
- `messageNormalizer` 思考/回复拆分测试
- `streamEventAdapter` 事件映射测试
- `createChatModel` 配置映射测试

### 10.2 集成测试

- Runtime 工具调用链路测试
  - 模型发出工具调用
  - Node.js 执行工具
  - 结果回填
  - 最终生成回复
- 后端预解析降级路径测试
- 占位短链 `toolStatus` 测试
- 无工具纯文本回复测试

### 10.3 回归测试

- `POST /api/ai/chat` 路由测试
- `POST /api/ai/chat/stream` 路由测试
- 前端静态页联调用例
- 当前已有 AI 相关测试全部继续保留并迁移

### 10.4 手工验证

- 真实抖音短链
- 文案中包含抖音链接
- 无效链接
- 无链接纯对话
- 流式输出中包含工具结果

---

## 11. 里程碑与验收标准

## Milestone 1：边界抽离完成

验收标准：
- `AIChatService` 不再直接持有大段协议处理逻辑
- prompt、session、消息规范化已独立成模块
- 所有现有测试仍通过

## Milestone 2：LangChain 工具与模型接入完成

验收标准：
- `parseDouyinVideoTool` 已通过 LangChain tool 注册
- 模型可通过 LangChain 正常调用工具
- 非流式接口返回结果与现有契约一致

## Milestone 3：流式链路迁移完成

验收标准：
- `chatStream()` 不再依赖旧 provider 的流式协议解析
- SSE 契约完全兼容现有前端
- 现有流式测试与手工验证通过

## Milestone 4：旧实现清理完成

验收标准：
- 删除 `OpenAICompatibleProvider` 及其调用路径
- 旧 `_executeToolCalls()` 等手写协议胶水已删除
- 文档、测试、代码结构一致

---

## 12. 建议的提交拆分

### 提交 1：抽离 AI 边界模块

建议提交信息：
```text
refactor(ai): extract prompt session and message normalization modules
```

### 提交 2：引入 LangChain 工具注册表

建议提交信息：
```text
feat(ai): add langchain tool registry for douyin parsing
```

### 提交 3：接入 LangChain 模型工厂

建议提交信息：
```text
refactor(ai): replace legacy llm provider with langchain model factory
```

### 提交 4：迁移非流式 AI 编排

建议提交信息：
```text
refactor(ai): migrate chat orchestration to langchain runtime
```

### 提交 5：迁移流式编排与 SSE 适配

建议提交信息：
```text
refactor(ai): migrate streaming chat flow to langchain runtime
```

### 提交 6：清理旧实现与文档

建议提交信息：
```text
chore(ai): remove legacy ai provider implementation
```

---

## 13. 最终建议

结论：
- 对当前项目而言，迁移到 `LangChain.js` 是合理的中长期方向
- 但必须采用渐进式改造，而不是一次性重写
- 第一优先级不是“尽快把代码写成 LangChain 风格”，而是先把 AI 相关边界抽干净
- 只要应用层契约稳定，未来迁移到 `NestJS` 的成本会显著下降

推荐执行顺序：
- 先做 Phase 1
- 再做 Phase 2 和 Phase 3
- 等非流式稳定后，再做 Phase 5
- LangGraph 保持预留，不在首轮强制引入

如果执行过程中发现“仅 1 个工具 + 1 条链路”的复杂度不足以支撑完整 LangChain runtime，也可以在 Phase 2 后暂停，先保留“工具注册表 + model factory + 应用服务层”结构，等第二个、第三个工具出现后再继续推进 Phase 4。

---

## 14. 当前实施进度（Todo）

> 审核日期：2026-04-24
> 审核依据：当前工作区代码、AI 相关测试、目录结构与实施计划逐项对照

### 总体判断

- [x] 已达到“已迁移到 LangChain Agent Runtime 并完成旧实现清理”的目标状态
- [x] 已完成边界抽离、LangChain 模型接入、工具注册表、Agent Runtime 与流式事件适配
- [x] 当前代码已收口到单一 LangChain 主实现，不再保留 legacy provider/runtime 开关分支

### Phase 0：准备阶段

- [ ] 文档中未见明确的契约快照、基线样例记录或基线测试产物
- [ ] 未见实施分支/提交拆分信息写回文档
- [x] 当前 AI 相关测试可通过，已具备基本回归基础

完成度判断：部分完成

### Phase 1：抽离框架无关的应用边界

- [x] 已提取 `backend/ai/prompts/systemPrompt.js`
- [x] 已提取 `backend/ai/sessions/AISessionStore.js`
- [x] 已提取 `backend/ai/runtime/messageNormalizer.js`
- [x] 已提取 `backend/ai/runtime/streamEventAdapter.js`
- [x] `backend/services/AIChatService.js` 已明显收缩，主要作为 façade 协调入口
- [x] 已落地 `backend/ai/application/AIChatAppService.js`
- [x] 已落地 `backend/ai/application/AIStreamAppService.js`

完成度判断：已完成

### Phase 2：建立 Tool Registry 与 LangChain Tool 适配层

- [x] 已新增 `backend/ai/infra/langchain/langChainToolAdapterFactory.js`
- [x] 已新增 `backend/ai/tools/index.js`
- [x] `backend/services/tools/parseDouyinVideoTool.js` 已提供 `langChainTool`
- [x] 保留了旧导出兼容层（`definition` / `execute` / `inputSchema`）
- [x] runtime 已优先消费 `langChainTools`，同时保留旧 `definition` 兜底

完成度判断：基本完成

### Phase 3：替换模型适配层

- [x] 已新增 `backend/ai/infra/model/createChatModel.js`
- [x] 已新增 `backend/ai/infra/model/LangChainProvider.js`
- [x] `backend/services/llm/LLMClientFactory.js` 已通过 `createChatModel()` 创建 LangChain `ChatOpenAI`
- [x] `baseURL`、`apiKey`、`model`、`temperature`、`maxTokens` 已继续兼容
- [x] 默认主链路已改为 `LangChainProvider`
- [x] `OpenAICompatibleProvider` 已删除，不再保留回退路径
- [x] 业务层已不再依赖 legacy provider 的 `toolCalls` 协议兼容分支
- [x] 原 `openAICompatibleProvider.test.js` 已删除，并由新的 provider/model 测试替代

完成度判断：已完成

### Phase 4：引入 LangChain Runtime

- [x] 已新增 `backend/ai/runtime/createChatRuntime.js`
- [x] 已新增 `backend/ai/runtime/toolCallingConfig.js`
- [x] 后端预解析降级路径已收敛到 runtime policy
- [x] 默认主路径已通过 LangChain provider + runtime 编排管理工具调用循环
- [x] 应用层已从 runtime 输出中提取工具结果与最终回复
- [x] `createChatRuntime.js` 已收口旧主路径，仅保留统一 runtime 编排逻辑
- [x] 计划目标“完全移除旧 `AIChatService` 手写工具循环主路径”已达成

完成度判断：已完成

### Phase 5：统一非流式与流式编排

- [x] `chat()` 与 `chatStream()` 已统一复用 `createChatRuntime()`
- [x] 流式模式已通过 `streamEventAdapter` 做 SSE 事件映射
- [x] `session/progress/tool_result/thinking_delta/reply_delta/done` 契约已覆盖在测试中
- [x] `messageNormalizer` 已集中处理 `<minimax:tool_call>` 与 `<think>` 兼容逻辑
- [x] 供应商遗留兼容逻辑已收敛到必要的消息规范化层，不再存在 runtime 双分支

完成度判断：已完成

### Phase 6：清理旧实现并稳定 API

- [x] 已移除 `AI_RUNTIME=legacy|langchain`
- [x] 已移除 `AI_STREAM_RUNTIME=legacy|langchain`
- [x] `OpenAICompatibleProvider` 已删除
- [x] 手写协议胶水已移除，不再保留 legacy 回退路径
- [x] 文档、代码、测试已收口到单一 LangChain 实现

完成度判断：已完成

### 里程碑判断

- [x] Milestone 1：已达成
- [x] Milestone 2：已达成
- [x] Milestone 3：已达成
- [x] Milestone 4：已达成

### 当前实际进度结论

- [x] 可判定当前整体进度已达到本实施计划定义的收口状态
- [x] 可以宣称“AI 主链路已完成重构到 LangChain”
- [x] 更准确的表述应为：
  - [x] 已完成 AI 边界抽离、应用服务层补齐、LangChain 模型接入、默认主链路切换、LangChain agent runtime 替换、工具注册表建设、流式适配收敛
  - [x] 已完成 legacy Provider、legacy loop、runtime 开关分支及对应测试的最终清理
