const test = require('node:test');
const assert = require('node:assert/strict');

const AIChatService = require('../services/AIChatService');
const LLMClientFactory = require('../services/llm/LLMClientFactory');
const parseDouyinVideoTool = require('../services/tools/parseDouyinVideoTool');

test('AIChatService.chatStream 输出 session、tool_result、done，并仅保存最终 reply', async () => {
  const originalCreate = LLMClientFactory.create;
  const originalExecute = parseDouyinVideoTool.execute;

  LLMClientFactory.create = () => ({
    getName: () => 'openai-compatible',
    streamGenerate: async function* () {
      yield { type: 'content_delta', delta: '<think>先执行工具</think>' };
      yield { type: 'content_delta', delta: '解析完成。' };
    },
    generate: async () => ({
      content: '继续回答',
      toolCalls: []
    })
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

    assert.equal(result.thinking, '先执行工具');
    assert.equal(result.reply, '解析完成。');
    assert.equal(result.parsedData.shareUrl, 'https://v.douyin.com/tool');
    assert.equal(result.toolStatus.status, 'resolved');
    assert.deepEqual(result.toolStatus.warnings, []);
    assert.equal(events[0].event, 'session');
    assert.equal(events[1].event, 'progress');
    assert.equal(events[2].event, 'tool_result');
    assert.equal(events[2].payload.toolStatus.status, 'resolved');
    assert.equal(events.at(-1).event, 'done');

    const nextResult = await AIChatService.chat('继续', 'session-stream');
    assert.equal(nextResult.reply.length > 0, true);
  } finally {
    LLMClientFactory.create = originalCreate;
    parseDouyinVideoTool.execute = originalExecute;
  }
});

test('AIChatService.chatStream 在占位短链场景下将 tool_result 标记为 suspect', async () => {
  const originalCreate = LLMClientFactory.create;
  const originalExecute = parseDouyinVideoTool.execute;

  LLMClientFactory.create = () => ({
    getName: () => 'openai-compatible',
    streamGenerate: async function* () {
      yield { type: 'content_delta', delta: '该链接看起来像占位符。' };
    },
    generate: async () => ({
      content: '继续回答',
      toolCalls: []
    })
  });

  parseDouyinVideoTool.execute = async () => ({
    title: '占位示例',
    author: '测试作者',
    shareUrl: 'https://v.douyin.com/xxxxx/',
    audioReady: false
  });

  const events = [];

  try {
    const result = await AIChatService.chatStream('帮我解析 https://v.douyin.com/xxxxx/', 'session-placeholder', {
      onEvent(event, payload) {
        events.push({ event, payload });
      }
    });

    const toolEvent = events.find((event) => event.event === 'tool_result');
    assert.ok(toolEvent);
    assert.equal(toolEvent.payload.toolStatus.status, 'suspect');
    assert.deepEqual(toolEvent.payload.toolStatus.warnings, ['placeholder_share_url']);
    assert.equal(result.toolStatus.status, 'suspect');
    assert.deepEqual(result.toolStatus.warnings, ['placeholder_share_url']);
  } finally {
    LLMClientFactory.create = originalCreate;
    parseDouyinVideoTool.execute = originalExecute;
  }
});

test('AIChatService.chatStream 在 think 标签未闭合时不应把思考片段发到 reply_delta', async () => {
  const originalCreate = LLMClientFactory.create;

  LLMClientFactory.create = () => ({
    getName: () => 'openai-compatible',
    streamGenerate: async function* () {
      yield { type: 'content_delta', delta: '<think>用户' };
      yield { type: 'content_delta', delta: '在提问' };
      yield { type: 'content_delta', delta: '</think>正式回答' };
    },
    generate: async () => ({
      content: '继续回答',
      toolCalls: []
    })
  });

  const events = [];

  try {
    const result = await AIChatService.chatStream('你好', 'session-think-split', {
      onEvent(event, payload) {
        events.push({ event, payload });
      }
    });

    const replyDeltas = events
      .filter((event) => event.event === 'reply_delta')
      .map((event) => event.payload.delta);

    const thinkingDeltas = events
      .filter((event) => event.event === 'thinking_delta')
      .map((event) => event.payload.delta);

    assert.deepEqual(replyDeltas, ['正式回答']);
    assert.equal(thinkingDeltas.join(''), '用户在提问');
    assert.equal(result.thinking, '用户在提问');
    assert.equal(result.reply, '正式回答');
  } finally {
    LLMClientFactory.create = originalCreate;
  }
});

test('AIChatService.chatStream 应过滤 Minimax 工具调用标记并在 reply 为空时回退为解析总结', async () => {
  const originalCreate = LLMClientFactory.create;
  const originalExecute = parseDouyinVideoTool.execute;

  LLMClientFactory.create = () => ({
    getName: () => 'openai-compatible',
    streamGenerate: async function* () {
      yield { type: 'content_delta', delta: '<think>准备返回结果</think>' };
      yield { type: 'content_delta', delta: '<minimax:tool_call>\n<invoke name="douyin_parse">' };
      yield { type: 'content_delta', delta: '\n<parameter name="url">https://www.douyin.com/video/1</parameter>' };
      yield { type: 'content_delta', delta: '\n</invoke>\n</minimax:tool_call>' };
    },
    generate: async () => ({
      content: '继续回答',
      toolCalls: []
    })
  });

  parseDouyinVideoTool.execute = async () => ({
    title: '真实视频标题',
    author: '真实作者',
    shareUrl: 'https://www.douyin.com/video/1',
    audioReady: true
  });

  const events = [];

  try {
    const result = await AIChatService.chatStream('帮我解析 https://www.douyin.com/video/1', 'session-minimax-tool-call', {
      onEvent(event, payload) {
        events.push({ event, payload });
      }
    });

    const replyDeltas = events
      .filter((event) => event.event === 'reply_delta')
      .map((event) => event.payload.delta)
      .join('');

    assert.equal(replyDeltas.includes('minimax:tool_call'), false);
    assert.equal(result.reply.includes('minimax:tool_call'), false);
    assert.equal(result.reply, '解析成功，标题：真实视频标题，作者：真实作者。当前可直接获取音频。');
  } finally {
    LLMClientFactory.create = originalCreate;
    parseDouyinVideoTool.execute = originalExecute;
  }
});

test('AIChatService.chatStream 不应发送纯空白 reply_delta', async () => {
  const originalCreate = LLMClientFactory.create;

  LLMClientFactory.create = () => ({
    getName: () => 'openai-compatible',
    streamGenerate: async function* () {
      yield { type: 'content_delta', delta: '<think>先思考</think>\n\n\n正式回答' };
    },
    generate: async () => ({
      content: '继续回答',
      toolCalls: []
    })
  });

  const events = [];

  try {
    const result = await AIChatService.chatStream('你好', 'session-reply-whitespace', {
      onEvent(event, payload) {
        events.push({ event, payload });
      }
    });

    const replyDeltas = events
      .filter((event) => event.event === 'reply_delta')
      .map((event) => event.payload.delta);

    assert.deepEqual(replyDeltas, ['正式回答']);
    assert.equal(result.reply, '正式回答');
  } finally {
    LLMClientFactory.create = originalCreate;
  }
});
