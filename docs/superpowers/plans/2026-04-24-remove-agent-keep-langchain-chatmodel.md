# Remove Agent Keep LangChain ChatModel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除基于 LangChain AgentExecutor 的运行时实现，保留 LangChain ChatModel 与工具定义，通过手动 tool calling 编排维持现有对话接口行为。

**Architecture:** 保留 `LangChainProvider` 作为统一模型访问层，由运行时直接调用 `generate`/`streamGenerate` 并解析 `toolCalls`。当模型触发 `parse_douyin_video` 时，由服务端手动执行工具并将结果回填给模型进行最终回复生成，同时保留现有后端降级解析逻辑。

**Tech Stack:** Node.js, LangChain ChatOpenAI, Zod, Node test runner

---

### Task 1: 调整运行时测试到非 Agent 模式

**Files:**
- Modify: `backend/tests/createChatAgent.test.js`
- Modify: `backend/tests/aiChatService.test.js`
- Modify: `backend/tests/aiApplicationServices.test.js`

- [ ] **Step 1: 写出失败测试，表达“直接 generate/toolCalls”主路径**
- [ ] **Step 2: 运行相关测试，确认旧实现不满足新断言**
- [ ] **Step 3: 仅按新断言补齐最小测试桩与期望**
- [ ] **Step 4: 再次运行相关测试，确认失败点集中在运行时实现**

### Task 2: 将 createChatAgent 改为手动 tool calling 编排

**Files:**
- Modify: `backend/ai/runtime/createChatAgent.js`
- Modify: `backend/ai/runtime/agentConfig.js`

- [ ] **Step 1: 先补失败测试覆盖非流式工具调用、纯文本回复、流式回填**
- [ ] **Step 2: 去掉 `AgentExecutor/createToolCallingAgent` 依赖，改成 `provider.generate`/`provider.streamGenerate` 两段式实现**
- [ ] **Step 3: 保留 fallback parse、稳定错误语义与现有输出结构**
- [ ] **Step 4: 运行运行时测试并修正最小实现**

### Task 3: 校正应用层兼容性并执行回归

**Files:**
- Modify: `backend/tests/aiApplicationServices.test.js`
- Modify: `backend/tests/aiChatService.stream.test.js`
- Modify: `backend/tests/langChainProvider.test.js`（仅在行为受影响时）

- [ ] **Step 1: 运行与 AI runtime 相关的测试集合，记录回归点**
- [ ] **Step 2: 只修正与去 agent 化直接相关的断言或兼容层**
- [ ] **Step 3: 运行完整后端测试，确认无回归**
- [ ] **Step 4: 整理结果并输出改动说明与剩余风险**
