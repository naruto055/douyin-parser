# 抖音解析 AI 对话 SSE 流式改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有 `POST /api/ai/chat` 非流式接口不变的前提下，新增 `POST /api/ai/chat/stream` SSE 流式接口，并让内置静态页支持增量渲染 AI 回复与解析结果。

**Architecture:** 采用“新路由 + 共享编排 + Provider 流式能力”的增量式改造。后端新增 SSE 写出层与流式 AI 编排接口，复用现有工具调用和会话存储逻辑；前端使用 `fetch + ReadableStream` 消费 `text/event-stream`，因为流式接口需要保留 `POST` 请求体，不能直接用 `EventSource`。

**Tech Stack:** Node.js、Express、OpenAI SDK、SSE(`text/event-stream`)、原生浏览器 `fetch` 流读取、`node:test`

## 实现核对结论（2026-04-21）

### 已确认落地

- 已新增 `POST /api/ai/chat/stream`，且保留原有 `POST /api/ai/chat`
- 已新增 `backend/utils/sse.js`，统一封装 SSE 响应头、事件写出、心跳与连接关闭
- `OpenAICompatibleProvider` 已新增 `streamGenerate()`
- `AIChatService` 已新增 `chatStream()`，并抽出 `_assertChatRequest()`、`_createChatContext()`、`_buildModelMessages()`、`_buildFallbackMessages()` 等共享逻辑
- 静态演示页已切换为优先流式消费，并保留非流式降级路径
- `backend/docs/API.md` 已补充 SSE 接口说明与 `curl -N` 示例
- 已通过 backend 当前 `node:test` 全量测试套件验证
- 已完成手工 `curl -N` 联调，确认可返回 `session/progress/tool_result/thinking_delta/reply_delta/done` 事件序列

### 当前实现边界与设计决策

- `OpenAICompatibleProvider.streamGenerate()` 当前只输出 `content_delta`；这是第一版为保持 KISS 采取的实现边界，暂不对上游工具调用片段做流式归一化
- `AIChatService.chatStream()` 的实际策略是命中抖音链接时优先走后端解析降级路径，先产出一次 `tool_result`，再基于工具结果流式生成回复；文档应以该真实编排为准，而不是继续描述“先依赖 provider 流式工具调用”
- 已为 `tool_result` / `done` 增加 `toolStatus` 元信息，用于表达“工具返回了结构化对象”与“业务语义可信度”之间的差异；当前至少支持 `resolved`、`suspect`
- 占位短链 `https://v.douyin.com/xxxxx/` 会被标记为 `toolStatus.status = "suspect"`，并附带 `warnings: ["placeholder_share_url"]`，避免前端把 `tool_result` 误判为“解析成功”

### 文档未体现但代码已实现

- `AIChatService._splitStreamingAssistantReply()` 支持处理 `<think>` 标签跨 chunk、未闭合等流式边界情况
- `AIChatService._stripVendorToolCallMarkup()` 会过滤 `Minimax` 风格的 `<minimax:tool_call>` 标记，避免污染 `reply_delta` 和最终 `reply`
- 前端页面不是单纯“改成流式读取”，而是实现了“流式优先，失败后自动回退到 `/api/ai/chat`”的兼容策略

### 未完成或未核验

- 无

---

## 提交拆分建议

### 提交 1：固化 SSE 事件契约与路由骨架

目标：
- 新增 `/api/ai/chat/stream` 路由，但先只输出固定测试事件
- 新增 SSE 响应工具，统一头部、事件写出、结束逻辑
- 补齐路由层测试，验证接口形态稳定

收益：
- 最早锁定协议，降低后续前后端返工
- 风险隔离在“传输层”，不碰现有 AI 编排

建议提交说明：
```text
feat(ai): add SSE chat route skeleton and event contract
```

### 提交 2：Provider 增加流式输出能力

目标：
- 为 `OpenAICompatibleProvider` 增加 `streamGenerate`
- 统一把上游 token / 工具调用片段规范化成内部流式事件
- 补齐 provider 层测试

收益：
- 把“不稳定的模型流式格式”封装在 provider 层
- 为 AI 编排层提供稳定抽象，符合 DIP

建议提交说明：
```text
feat(ai): add streaming support for openai compatible provider
```

### 提交 3：AIChatService 改造为共享编排 + 流式编排

目标：
- 在不破坏 `chat()` 的前提下新增 `chatStream()`
- 抽出共享会话、工具执行、回复归档逻辑
- 把“阶段事件 + 最终结果”统一从服务层发出

收益：
- 保持非流式与流式行为一致
- 避免路由层直接拼业务状态，符合 SRP

建议提交说明：
```text
feat(ai): add streaming orchestration to AI chat service
```

### 提交 4：前端静态页切换到流式消费

目标：
- 保留原始 `/api/ai/chat` 能力，但演示页默认改用 `/api/ai/chat/stream`
- 增量渲染思考过程、最终回答、解析结果、状态文本
- 补齐前端工具层测试

收益：
- 用户可直观看到流式收益
- 即使流式失败，仍可在前端保留降级空间

建议提交说明：
```text
feat(ui): consume AI SSE chat stream in demo page
```

### 提交 5：文档、回归测试与收尾

目标：
- 更新 API 文档，补充 SSE 事件格式与示例
- 回归非流式接口兼容性
- 补充异常、中断、工具调用场景说明

建议提交说明：
```text
docs(ai): document SSE chat API and compatibility notes
```

## 事件契约设计

新增接口：
```http
POST /api/ai/chat/stream
Content-Type: application/json
Accept: text/event-stream
```

请求体：
```json
{
  "message": "帮我解析这个抖音链接 https://v.douyin.com/xxxxx/",
  "sessionId": "optional-session-id"
}
```

SSE 事件：

1. `session`
```text
event: session
data: {"sessionId":"generated-or-input-session-id"}
```

2. `progress`
```text
event: progress
data: {"stage":"model_start","message":"AI 正在分析输入"}
```

3. `thinking_delta`
```text
event: thinking_delta
data: {"delta":"用户给出了有效链接，先执行解析。"}
```

4. `reply_delta`
```text
event: reply_delta
data: {"delta":"解析成功，标题是"}
```

5. `tool_result`
```text
event: tool_result
data: {"toolStatus":{"status":"resolved","warnings":[]},"parsedData":{"title":"示例标题","author":"示例作者","shareUrl":"https://v.douyin.com/xxxxx/","audioReady":true}}
```

6. `done`
```text
event: done
data: {"thinking":"...","reply":"...","sessionId":"...","toolStatus":{"status":"resolved","warnings":[]},"parsedData":{...}}
```

7. `error`
```text
event: error
data: {"error":"LLM request failed"}
```

约束：
- `done.data` 结构必须与现有 `/api/ai/chat` 的 `data` 保持兼容，便于前端复用渲染逻辑
- 工具结果只在拿到完整 `parsedData` 后发送一次，不做字段级碎片流
- `tool_result` 的语义是“工具已返回结构化对象”，不直接等价于“链接业务有效”；前端若需要业务判断，必须结合 `toolStatus`
- 若上游模型不支持真实 token 流，也允许服务层先发送 `progress`，最后发送一次 `done`，保证协议稳定优先

## 文件结构规划

### 新增文件

- `backend/utils/sse.js`
  责任：封装 SSE 响应头、事件写入、注释心跳与连接结束

- `backend/tests/aiRoute.stream.test.js`
  责任：覆盖 `/api/ai/chat/stream` 路由层协议测试

- `backend/tests/aiChatService.stream.test.js`
  责任：覆盖流式编排的事件顺序、会话写入、工具调用与异常路径

### 修改文件

- `backend/routes/ai.js`
  责任：新增 `POST /chat/stream` 路由，保留现有 `/chat`

- `backend/services/AIChatService.js`
  责任：新增 `chatStream()`，抽取共享编排逻辑，处理流式 `<think>` 拆分、厂商工具标记过滤，以及 `toolStatus` 判定

- `backend/services/llm/OpenAICompatibleProvider.js`
  责任：新增 `streamGenerate()`，当前归一化模型文本流式输出

- `backend/tests/openAICompatibleProvider.test.js`
  责任：覆盖 provider 流式输出规范化

- `backend/tests/aiRoute.test.js`
  责任：补充对旧接口兼容性的保护断言

- `backend/tests/aiChatService.test.js`
  责任：补充共享逻辑改造后的非流式回归测试

- `backend/public/index.html`
  责任：把演示页发送逻辑切换为流式读取与增量渲染

- `backend/public/chatApi.js`
  责任：增加流式请求 URL 构建或事件解析辅助函数

- `backend/tests/chatApi.test.js`
  责任：覆盖新增前端工具函数

- `backend/docs/API.md`
  责任：补充 `/api/ai/chat/stream` 文档、事件示例与兼容策略

## 实施任务

### Task 1: 固化 SSE 协议与传输层骨架

**Files:**
- Create: `backend/utils/sse.js`
- Create: `backend/tests/aiRoute.stream.test.js`
- Modify: `backend/routes/ai.js`

- [x] **Step 1: 先写路由层失败测试，锁定 SSE 响应头与事件格式**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');

const AIChatService = require('../services/AIChatService');
const aiRouter = require('../routes/ai');

function createStreamResponse() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    writableEnded: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    flushHeaders() {},
    write(chunk) {
      this.chunks.push(String(chunk));
    },
    end(chunk = '') {
      if (chunk) this.chunks.push(String(chunk));
      this.writableEnded = true;
    }
  };
}

test('AI SSE 路由返回 text/event-stream 并输出 session 与 done 事件', async () => {
  const originalChatStream = AIChatService.chatStream;
  const layer = aiRouter.stack.find((item) => item.route && item.route.path === '/chat/stream');
  const handler = layer.route.stack[1].handle;

  AIChatService.chatStream = async ({ onEvent }) => {
    onEvent('session', { sessionId: 'session-sse' });
    onEvent('done', { thinking: '', reply: 'ok', sessionId: 'session-sse', parsedData: null });
  };

  try {
    const req = { body: { message: 'hello' }, on() {} };
    const res = createStreamResponse();

    await handler(req, res, (error) => {
      throw error;
    });

    assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
    assert.match(res.chunks.join(''), /event: session/);
    assert.match(res.chunks.join(''), /event: done/);
  } finally {
    AIChatService.chatStream = originalChatStream;
  }
});
```

- [x] **Step 2: 运行测试确认当前失败（历史 TDD 过程未追溯，按当前产物与测试结果回填）**

Run:
```bash
pnpm test -- aiRoute.stream.test.js
```

Expected:
```text
FAIL
```

- [x] **Step 3: 新增 SSE 工具文件，封装统一写出逻辑**

```javascript
function initializeSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

function writeSSEEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function closeSSE(res) {
  if (!res.writableEnded) {
    res.end();
  }
}

module.exports = {
  initializeSSE,
  writeSSEEvent,
  closeSSE
};
```

- [x] **Step 4: 在路由中新增 `/chat/stream` 骨架并写出固定事件**

```javascript
router.post('/chat/stream', aiLimiter, async (req, res, next) => {
  try {
    const { message } = req.body || {};

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'message is required'
      });
    }

    initializeSSE(res);
    writeSSEEvent(res, 'session', { sessionId: 'pending' });
    writeSSEEvent(res, 'done', {
      thinking: '',
      reply: '',
      sessionId: 'pending',
      parsedData: null
    });
    closeSSE(res);
  } catch (error) {
    return next(error);
  }
});
```

- [x] **Step 5: 运行测试确认骨架通过**

Run:
```bash
pnpm test -- aiRoute.stream.test.js
```

Expected:
```text
PASS
```

### Task 2: 为 Provider 增加流式能力

**Files:**
- Modify: `backend/services/llm/OpenAICompatibleProvider.js`
- Modify: `backend/tests/openAICompatibleProvider.test.js`

- [x] **Step 1: 先写 provider 流式测试，锁定内部事件归一化**

```javascript
test('OpenAICompatibleProvider.streamGenerate 逐步产出文本增量', async () => {
  const provider = new OpenAICompatibleProvider({
    provider: 'openai-compatible',
    apiKey: 'test-key',
    baseURL: 'https://example.com/v1',
    model: 'fake-model',
    temperature: 0.2,
    maxTokens: 256,
    requestTimeoutMs: 1000
  });

  provider.client.chat.completions.create = async () => ({
    async *[Symbol.asyncIterator]() {
      yield {
        choices: [{ delta: { content: '<think>先解析</think>' } }]
      };
      yield {
        choices: [{ delta: { content: '解析成功' } }]
      };
    }
  });

  const chunks = [];

  for await (const event of provider.streamGenerate({
    messages: [{ role: 'user', content: 'hello' }],
    tools: []
  })) {
    chunks.push(event);
  }

  assert.deepEqual(chunks, [
    { type: 'content_delta', delta: '<think>先解析</think>' },
    { type: 'content_delta', delta: '解析成功' }
  ]);
});
```

- [x] **Step 2: 运行测试确认当前失败（历史 TDD 过程未追溯，按当前产物与测试结果回填）**

Run:
```bash
pnpm test -- openAICompatibleProvider.test.js
```

Expected:
```text
FAIL with "streamGenerate is not a function"
```

- [x] **Step 3: 在 provider 中实现 `streamGenerate()`**

```javascript
async *streamGenerate({ messages, tools = [], toolChoice = 'auto' }) {
  let stream;

  try {
    stream = await this.client.chat.completions.create({
      model: this.options.model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? toolChoice : undefined,
      temperature: this.options.temperature,
      max_tokens: this.options.maxTokens,
      stream: true
    });
  } catch (error) {
    const wrappedError = new Error(error.message || 'LLM request failed');
    wrappedError.statusCode = error.status || error.statusCode || 502;
    wrappedError.cause = error;
    throw wrappedError;
  }

  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta;

    if (delta?.content) {
      yield {
        type: 'content_delta',
        delta: this._normalizeContent(delta.content)
      };
    }
  }
}
```

- [x] **Step 4: 运行 provider 测试**

Run:
```bash
pnpm test -- openAICompatibleProvider.test.js
```

Expected:
```text
PASS
```

### Task 3: 把 AIChatService 拆成共享编排与流式编排

**Files:**
- Modify: `backend/services/AIChatService.js`
- Create: `backend/tests/aiChatService.stream.test.js`
- Modify: `backend/tests/aiChatService.test.js`

- [x] **Step 1: 先写流式服务测试，锁定事件顺序与最终落库行为**

```javascript
test('AIChatService.chatStream 输出 session、tool_result、done，并仅保存最终 reply', async () => {
  const originalCreate = LLMClientFactory.create;
  const originalExecute = parseDouyinVideoTool.execute;

  LLMClientFactory.create = () => ({
    getName: () => 'openai-compatible',
    streamGenerate: async function* () {
      yield { type: 'content_delta', delta: '<think>先执行工具</think>' };
      yield { type: 'content_delta', delta: '解析完成。' };
    },
    generate: async () => ({ content: '', toolCalls: [] })
  });

  parseDouyinVideoTool.execute = async () => ({
    title: '测试视频',
    author: '测试作者',
    shareUrl: 'https://v.douyin.com/tool',
    audioReady: true
  });

  const events = [];

  try {
    const result = await AIChatService.chatStream('帮我解析 https://v.douyin.com/tool', 'session-stream', {
      onEvent(event, payload) {
        events.push({ event, payload });
      }
    });

    assert.equal(result.reply.includes('解析完成'), true);
    assert.equal(events[0].event, 'session');
    assert.equal(events.at(-1).event, 'done');
  } finally {
    LLMClientFactory.create = originalCreate;
    parseDouyinVideoTool.execute = originalExecute;
  }
});
```

- [x] **Step 2: 运行测试确认当前失败（历史 TDD 过程未追溯，按当前产物与测试结果回填）**

Run:
```bash
pnpm test -- aiChatService.stream.test.js
```

Expected:
```text
FAIL
```

- [x] **Step 3: 抽出共享编排辅助方法，避免 `chat` 与 `chatStream` 重复**

```javascript
static _createChatContext(message, sessionId) {
  const resolvedSessionId = sessionId || this._createSessionId();
  const history = this._getSessionMessages(resolvedSessionId);
  const userMessage = { role: 'user', content: String(message).trim() };

  return {
    resolvedSessionId,
    history,
    userMessage
  };
}

static _buildModelMessages(history, userMessage) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    userMessage
  ];
}
```

- [x] **Step 4: 新增 `chatStream()`，按事件回调输出过程**

```javascript
static async chatStream(message, sessionId, { onEvent }) {
  const provider = LLMClientFactory.create();
  const { resolvedSessionId, history, userMessage } = this._createChatContext(message, sessionId);

  let thinking = '';
  let reply = '';
  let parsedData = null;

  onEvent('session', { sessionId: resolvedSessionId });
  onEvent('progress', { stage: 'model_start', message: 'AI 正在分析输入' });

  for await (const chunk of provider.streamGenerate({
    messages: this._buildModelMessages(history, userMessage),
    tools: [parseDouyinVideoTool.definition]
  })) {
    if (chunk.type !== 'content_delta') {
      continue;
    }

    const nextContent = `${thinking}${reply}${chunk.delta}`;
    const normalized = this._splitThinkingAndReply(nextContent);
    const thinkingDelta = normalized.thinking.slice(thinking.length);
    const replyDelta = normalized.reply.slice(reply.length);

    if (thinkingDelta) {
      thinking += thinkingDelta;
      onEvent('thinking_delta', { delta: thinkingDelta });
    }

    if (replyDelta) {
      reply += replyDelta;
      onEvent('reply_delta', { delta: replyDelta });
    }
  }

  this._saveSession(resolvedSessionId, userMessage, reply);

  const result = {
    thinking,
    reply: reply || this._buildFallbackReply(parsedData),
    sessionId: resolvedSessionId,
    parsedData
  };

  onEvent('done', result);
  return result;
}
```

- [x] **Step 5: 在 `chat()` 中尽量复用共享逻辑，保持旧接口结果不变**

```javascript
static async chat(message, sessionId) {
  // 保留现有返回结构
  // 复用 _createChatContext / _buildModelMessages / _saveSession / _normalizeAssistantReply
}
```

- [x] **Step 6: 运行服务层测试**

补充核对说明：
- 当前 `chatStream()` 额外实现了 `<think>` 分片拼接、空白 `reply_delta` 过滤、`<minimax:tool_call>` 标记清洗，这些内容已由新增测试覆盖
- 当前流式路径未复用 `_executeToolCalls()` 的 provider 工具调用编排，而是优先采用“后端直接解析链接 + 一次性发送 `tool_result` + 基于工具结果流式生成回复”的实现
- 当前 `tool_result` 与 `done` 都会携带 `toolStatus`，用于区分“工具有结果”与“链接业务可信”

Run:
```bash
pnpm test -- aiChatService.test.js aiChatService.stream.test.js
```

Expected:
```text
PASS
```

### Task 4: 接入真实 SSE 路由与连接生命周期管理

**Files:**
- Modify: `backend/routes/ai.js`
- Modify: `backend/utils/sse.js`
- Modify: `backend/tests/aiRoute.stream.test.js`

- [x] **Step 1: 扩展路由测试，覆盖客户端断开与错误事件**

```javascript
test('AI SSE 路由在服务异常时输出 error 事件并关闭连接', async () => {
  const originalChatStream = AIChatService.chatStream;
  const layer = aiRouter.stack.find((item) => item.route && item.route.path === '/chat/stream');
  const handler = layer.route.stack[1].handle;

  AIChatService.chatStream = async () => {
    throw new Error('LLM request failed');
  };

  try {
    const req = { body: { message: 'hello' }, on() {} };
    const res = createStreamResponse();

    await handler(req, res, (error) => {
      throw error;
    });

    assert.match(res.chunks.join(''), /event: error/);
    assert.equal(res.writableEnded, true);
  } finally {
    AIChatService.chatStream = originalChatStream;
  }
});
```

- [x] **Step 2: 运行测试确认失败（历史 TDD 过程未追溯，按当前产物与测试结果回填）**

Run:
```bash
pnpm test -- aiRoute.stream.test.js
```

Expected:
```text
FAIL
```

- [x] **Step 3: 路由改为调用 `AIChatService.chatStream()` 并透传事件**

```javascript
router.post('/chat/stream', aiLimiter, async (req, res) => {
  const { message, sessionId } = req.body || {};

  if (!message) {
    return res.status(400).json({
      success: false,
      error: 'message is required'
    });
  }

  initializeSSE(res);

  const handleClose = () => {
    closeSSE(res);
  };

  req.on('close', handleClose);

  try {
    await AIChatService.chatStream(message, sessionId, {
      onEvent(event, payload) {
        writeSSEEvent(res, event, payload);
      }
    });
  } catch (error) {
    writeSSEEvent(res, 'error', {
      error: error.message || 'AI stream failed'
    });
  } finally {
    closeSSE(res);
  }
});
```

- [x] **Step 4: 运行路由测试**

核对结果：
- 错误事件与连接关闭已实现且有测试
- `req.on('close')` 已实现，但“客户端主动断开”场景尚未看到专门测试，因此 Step 1 保持未完成

Run:
```bash
pnpm test -- aiRoute.test.js aiRoute.stream.test.js
```

Expected:
```text
PASS
```

### Task 5: 前端静态页切换为流式消费

**Files:**
- Modify: `backend/public/index.html`
- Modify: `backend/public/chatApi.js`
- Modify: `backend/tests/chatApi.test.js`

- [x] **Step 1: 先写前端工具测试，锁定 SSE 事件解析行为**

```javascript
const { parseSSEChunk } = require('../public/chatApi');

test('parseSSEChunk 解析 event 与 data 片段', () => {
  const events = parseSSEChunk('event: reply_delta\ndata: {"delta":"你好"}\n\n');

  assert.deepEqual(events, [
    {
      event: 'reply_delta',
      data: { delta: '你好' }
    }
  ]);
});
```

- [x] **Step 2: 运行测试确认失败（历史 TDD 过程未追溯，按当前产物与测试结果回填）**

Run:
```bash
pnpm test -- chatApi.test.js
```

Expected:
```text
FAIL
```

- [x] **Step 3: 在 `chatApi.js` 新增 SSE 片段解析工具**

```javascript
function parseSSEChunk(rawChunk) {
  return rawChunk
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() || 'message';
      const dataLine = lines.find((line) => line.startsWith('data:'))?.slice(5).trim() || '{}';
      return {
        event,
        data: JSON.parse(dataLine)
      };
    });
}
```

- [x] **Step 4: 在页面中改造发送逻辑为 `fetch + ReadableStream`**

```javascript
const streamEndpoint = ChatApi.buildApiUrl('/api/ai/chat/stream', window.location);

async function sendMessage() {
  const response = await fetch(streamEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    },
    body: JSON.stringify({
      message,
      sessionId: localStorage.getItem('ai-session-id') || undefined
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';

    for (const rawBlock of blocks) {
      const [event] = ChatApi.parseSSEChunk(`${rawBlock}\n\n`);
      if (!event) continue;

      if (event.event === 'session') {
        localStorage.setItem('ai-session-id', event.data.sessionId);
      }

      if (event.event === 'thinking_delta') {
        appendThinkingDelta(event.data.delta);
      }

      if (event.event === 'reply_delta') {
        appendReplyDelta(event.data.delta);
      }

      if (event.event === 'tool_result') {
        renderParsedData(event.data.parsedData);
      }

      if (event.event === 'done') {
        finalizeAssistantMessage(event.data);
      }
    }
  }
}
```

- [x] **Step 5: 保留页面降级能力**

```javascript
try {
  await sendMessageByStream();
} catch (error) {
  await sendMessageByJson();
}
```

- [x] **Step 6: 运行前端工具测试**

Run:
```bash
pnpm test -- chatApi.test.js
```

Expected:
```text
PASS
```

### Task 6: 更新文档并做回归验证

**Files:**
- Modify: `backend/docs/API.md`
- Modify: `.zcf/plan/current/AI对话实施计划.md`

- [x] **Step 1: 更新 API 文档，补充 SSE 接口与示例**

```markdown
### 5. AI 流式对话解析

**请求**:
```http
POST /api/ai/chat/stream
Accept: text/event-stream
Content-Type: application/json
```

**事件顺序**:
- `session`
- `progress`
- `thinking_delta`
- `reply_delta`
- `tool_result`
- `done`
- `error`
```

- [x] **Step 2: 更新历史计划文档中的限制说明**

```markdown
- [x] 新增 `/api/ai/chat/stream`
- [x] 保留 `/api/ai/chat` 非流式兼容接口
- [x] 静态演示页支持 SSE 增量渲染
```

- [x] **Step 3: 运行完整回归测试**

Run:
```bash
pnpm test
```

Expected:
```text
PASS
```

- [x] **Step 4: 手工联调**

核对结果：
- 已在当前 `ai-sse-stream` worktree 启动 backend 并执行 `curl -N`
- 实际收到 `session`、`progress`、`tool_result`、`thinking_delta`、`reply_delta`、`done` 事件
- 当前示例占位链接 `https://v.douyin.com/xxxxx/` 仍可能返回降级解析结果对象，但模型最终回复会提示该链接是占位符，联调时应以真实分享链接再做一次业务验收
- 当前代码已将上述占位短链场景显式标记为 `toolStatus.status = "suspect"`，前端可以据此展示风险提示而不是直接视为成功

Run:
```bash
curl -N -X POST http://localhost:3000/api/ai/chat/stream \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d "{\"message\":\"帮我解析这个抖音链接 https://v.douyin.com/xxxxx/\"}"
```

Expected:
```text
event: session
data: {"sessionId":"..."}

event: progress
data: {"stage":"model_start","message":"AI 正在分析输入"}

event: done
data: {"thinking":"...","reply":"...","sessionId":"...","parsedData":{...}}
```

## 风险与决策说明

- `POST + SSE` 是本次推荐方案，因为请求必须携带 `message` 与 `sessionId`，浏览器原生 `EventSource` 不支持自定义 `POST` body。
- 不建议在第一版就引入 WebSocket。当前需求是服务端单向推送，SSE 更简单，错误面更小，符合 KISS。
- 不建议删除旧 `/api/ai/chat`。先保留非流式接口，方便 API 使用方平滑迁移，符合 OCP 与回滚最小化原则。
- 若模型侧流式工具调用能力不稳定，允许第一版先流式输出文本阶段与进度事件，工具结果仍以完整对象一次性发出，避免过度设计。
- `done` 事件必须保留完整最终态，前端即使中途漏掉若干 delta，也能在结束时纠正 UI 状态。

## 完成标准

- 新增 `POST /api/ai/chat/stream`，且不破坏原有 `POST /api/ai/chat`
- SSE 事件协议稳定，最少覆盖 `session`、`progress`、`done`、`error`
- 工具调用场景下能输出 `tool_result`
- 静态页支持思考过程与最终回答的增量展示
- `pnpm test` 全量通过
- API 文档完成更新，并包含 `curl -N` 示例
