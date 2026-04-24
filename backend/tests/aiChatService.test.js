const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../config');
const AIChatService = require('../services/AIChatService');
const LLMClientFactory = require('../services/llm/LLMClientFactory');
const parseDouyinVideoTool = require('../services/tools/parseDouyinVideoTool');
const AISessionStore = require('../ai/sessions/AISessionStore');
const { normalizeAssistantReply } = require('../ai/runtime/messageNormalizer');

function createMockChatProvider({ generate, streamGenerate }) {
  return {
    getName: () => 'openai-compatible',
    generate: generate || (async () => ({ content: '', toolCalls: [] })),
    streamGenerate: streamGenerate || (async function* () {})
  };
}

test('AIChatService 在工具调用场景下返回 thinking、reply 和 parsedData', async () => {
  const originalCreate = LLMClientFactory.create;
  const originalExecute = parseDouyinVideoTool.execute;

  LLMClientFactory.create = () => createMockChatProvider({
    async generate(input) {
      if (input.messages.some((message) => message.role === 'tool')) {
        return {
          content: '<think>这是工具调用后的思考</think>解析成功，标题是测试视频。',
          toolCalls: []
        };
      }

      return {
        content: '',
        toolCalls: [
          {
            id: 'tool-1',
            type: 'function',
            name: 'parse_douyin_video',
            arguments: '{"url":"https://v.douyin.com/tool"}'
          }
        ]
      };
    }
  });

  parseDouyinVideoTool.execute = async () => ({
    title: '测试视频',
    author: '测试作者',
    shareUrl: 'https://v.douyin.com/tool',
    audioReady: true
  });

  try {
    const result = await AIChatService.chat('帮我解析 https://v.douyin.com/tool', 'session-tool');

    assert.equal(result.thinking, '这是工具调用后的思考');
    assert.equal(result.reply, '解析成功，标题是测试视频。');
    assert.equal(result.parsedData.shareUrl, 'https://v.douyin.com/tool');
  } finally {
    LLMClientFactory.create = originalCreate;
    parseDouyinVideoTool.execute = originalExecute;
  }
});

test('AIChatService 在模型未返回工具调用时走后端降级路径并拆分思考内容', async () => {
  const originalCreate = LLMClientFactory.create;
  const originalExecute = parseDouyinVideoTool.execute;

  LLMClientFactory.create = () => createMockChatProvider({
    async generate() {
      return {
        content: '<think>这是后端降级路径的思考</think>已根据解析结果为你整理完成。',
        toolCalls: []
      };
    }
  });

  parseDouyinVideoTool.execute = async () => ({
    title: '降级视频',
    author: '降级作者',
    shareUrl: 'https://v.douyin.com/fallback',
    audioReady: false
  });

  try {
    const result = await AIChatService.chat('请解析这个链接 https://v.douyin.com/fallback', 'session-fallback');

    assert.equal(result.thinking, '这是后端降级路径的思考');
    assert.equal(result.reply, '已根据解析结果为你整理完成。');
    assert.equal(result.parsedData.audioReady, false);
    assert.equal(result.toolStatus.status, 'resolved');
    assert.deepEqual(result.toolStatus.warnings, []);
  } finally {
    LLMClientFactory.create = originalCreate;
    parseDouyinVideoTool.execute = originalExecute;
  }
});

test('AIChatService 在占位短链场景下返回 suspect toolStatus', async () => {
  const originalCreate = LLMClientFactory.create;
  const originalExecute = parseDouyinVideoTool.execute;

  LLMClientFactory.create = () => createMockChatProvider({
    async generate() {
      return {
        content: '这是占位链接。',
        toolCalls: []
      };
    }
  });

  parseDouyinVideoTool.execute = async () => ({
    title: '占位示例',
    author: '测试作者',
    shareUrl: 'https://v.douyin.com/xxxxx/',
    audioReady: false
  });

  try {
    const result = await AIChatService.chat('请解析这个链接 https://v.douyin.com/xxxxx/', 'session-placeholder');

    assert.equal(result.toolStatus.status, 'suspect');
    assert.deepEqual(result.toolStatus.warnings, ['placeholder_share_url']);
  } finally {
    LLMClientFactory.create = originalCreate;
    parseDouyinVideoTool.execute = originalExecute;
  }
});

test('AIChatService 在模型返回纯文本时返回空 thinking', async () => {
  const originalCreate = LLMClientFactory.create;

  LLMClientFactory.create = () => createMockChatProvider({
    async generate() {
      return {
        content: '你好，我可以帮你解析抖音链接。',
        toolCalls: []
      };
    }
  });

  try {
    const result = await AIChatService.chat('hello', 'session-plain');

    assert.equal(result.thinking, '');
    assert.equal(result.reply, '你好，我可以帮你解析抖音链接。');
    assert.equal(result.parsedData, null);
  } finally {
    LLMClientFactory.create = originalCreate;
  }
});

test('AIChatService 只把最终 reply 写入会话历史', async () => {
  const originalCreate = LLMClientFactory.create;
  const calls = [];

  LLMClientFactory.create = () => createMockChatProvider({
    async generate({ messages }) {
      calls.push(messages);

      if (calls.length === 1) {
        return {
          content: '<think>第一轮思考</think>第一轮回答',
          toolCalls: []
        };
      }

      return {
        content: '第二轮回答',
        toolCalls: []
      };
    }
  });

  try {
    const first = await AIChatService.chat('第一轮问题', 'session-history');
    const second = await AIChatService.chat('第二轮问题', 'session-history');

    assert.equal(first.thinking, '第一轮思考');
    assert.equal(first.reply, '第一轮回答');
    assert.equal(second.reply, '第二轮回答');
    assert.deepEqual(calls[1], [
      { role: 'system', content: calls[1][0].content },
      { role: 'user', content: '第一轮问题' },
      { role: 'assistant', content: '第一轮回答' },
      { role: 'user', content: '第二轮问题' }
    ]);
  } finally {
    LLMClientFactory.create = originalCreate;
  }
});

test('AIChatService 在关闭 AI 开关时返回错误', async () => {
  const originalEnabled = config.ai.enabled;
  config.ai.enabled = false;

  try {
    await assert.rejects(() => AIChatService.chat('hello'), /AI chat is disabled/);
  } finally {
    config.ai.enabled = originalEnabled;
  }
});

test('AIChatService.chat 在 Phase 4 中不应依赖 _executeToolCalls 主路径', async () => {
  const originalCreate = LLMClientFactory.create;
  const originalExecute = parseDouyinVideoTool.execute;
  const originalExecuteToolCalls = AIChatService._executeToolCalls;

  LLMClientFactory.create = () => createMockChatProvider({
    async generate(input) {
      if (input.messages.some((message) => message.role === 'tool')) {
        return {
          content: 'runtime 主路径执行完成',
          toolCalls: []
        };
      }

      return {
        content: '',
        toolCalls: [
          {
            id: 'tool-runtime-main',
            type: 'function',
            name: 'parse_douyin_video',
            arguments: '{"url":"https://v.douyin.com/runtime-main"}'
          }
        ]
      };
    }
  });

  AIChatService._executeToolCalls = async () => {
    throw new Error('legacy _executeToolCalls should not be used in chat()');
  };

  parseDouyinVideoTool.execute = async () => ({
    title: 'runtime 主路径视频',
    author: '测试作者',
    shareUrl: 'https://v.douyin.com/runtime-main',
    audioReady: true
  });

  try {
    const result = await AIChatService.chat('请解析 https://v.douyin.com/runtime-main', 'session-runtime-main-path');

    assert.equal(result.reply, 'runtime 主路径执行完成');
    assert.equal(result.parsedData.shareUrl, 'https://v.douyin.com/runtime-main');
  } finally {
    LLMClientFactory.create = originalCreate;
    parseDouyinVideoTool.execute = originalExecute;
    AIChatService._executeToolCalls = originalExecuteToolCalls;
  }
});

test('AIChatService.chat 在模型没有返回有效结果且无降级路径时返回稳定错误', async () => {
  const originalCreate = LLMClientFactory.create;

  LLMClientFactory.create = () => createMockChatProvider({
    async generate() {
      return {
        content: '',
        toolCalls: []
      };
    }
  });

  try {
    await assert.rejects(
      () => AIChatService.chat('你好', 'session-empty-result'),
      (error) => {
        assert.equal(error.message, 'AI runtime ended without a valid reply');
        assert.equal(error.statusCode, 502);
        return true;
      }
    );
  } finally {
    LLMClientFactory.create = originalCreate;
  }
});

test('AIChatService.chat 在模型仅返回 toolCalls 且二次生成为空时仍应返回安全回退回复', async () => {
  const originalCreate = LLMClientFactory.create;
  const originalExecute = parseDouyinVideoTool.execute;
  let callCount = 0;

  LLMClientFactory.create = () => createMockChatProvider({
    async generate() {
      callCount += 1;

      if (callCount === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'tool-loop-limit',
              type: 'function',
              name: 'parse_douyin_video',
              arguments: '{"url":"https://v.douyin.com/loop-limit"}'
            }
          ]
        };
      }

      return {
        content: '',
        toolCalls: []
      };
    }
  });

  parseDouyinVideoTool.execute = async () => ({
    title: '循环上限视频',
    author: '测试作者',
    shareUrl: 'https://v.douyin.com/loop-limit',
    audioReady: true
  });

  try {
    const result = await AIChatService.chat('请解析 https://v.douyin.com/loop-limit', 'session-loop-limit');

    assert.equal(result.parsedData.shareUrl, 'https://v.douyin.com/loop-limit');
    assert.equal(result.reply, '解析成功，标题：循环上限视频，作者：测试作者。当前可直接获取音频。');
  } finally {
    LLMClientFactory.create = originalCreate;
    parseDouyinVideoTool.execute = originalExecute;
  }
});

test('AIChatService 在 tool call 参数不是合法 JSON 时返回统一错误语义', async () => {
  const originalCreate = LLMClientFactory.create;
  const originalExecute = parseDouyinVideoTool.execute;
  let executeCalled = false;

  LLMClientFactory.create = () => createMockChatProvider({
    async generate() {
      return {
        content: '',
        toolCalls: [
          {
            id: 'tool-invalid-json',
            type: 'function',
            name: 'parse_douyin_video',
            arguments: '{invalid-json'
          }
        ]
      };
    }
  });

  parseDouyinVideoTool.execute = async () => {
    executeCalled = true;
    return {};
  };

  try {
    await assert.rejects(
      () => AIChatService.chat('帮我解析工具结果', 'session-invalid-json'),
      (error) => {
        assert.equal(error.message, 'AI runtime ended without a valid reply');
        assert.equal(error.statusCode, 502);
        return true;
      }
    );
    assert.equal(executeCalled, false);
  } finally {
    LLMClientFactory.create = originalCreate;
    parseDouyinVideoTool.execute = originalExecute;
  }
});

test('AIChatService 在 tool call 参数是合法 JSON 但非对象时返回统一错误语义', async () => {
  const originalCreate = LLMClientFactory.create;
  const originalExecute = parseDouyinVideoTool.execute;
  let executeCalled = false;

  LLMClientFactory.create = () => createMockChatProvider({
    async generate() {
      return {
        content: '',
        toolCalls: [
          {
            id: 'tool-invalid-shape',
            type: 'function',
            name: 'parse_douyin_video',
            arguments: '["not-an-object"]'
          }
        ]
      };
    }
  });

  parseDouyinVideoTool.execute = async () => {
    executeCalled = true;
    return {};
  };

  try {
    await assert.rejects(
      () => AIChatService.chat('帮我解析工具结果', 'session-invalid-shape'),
      (error) => {
        assert.equal(error.message, 'AI runtime ended without a valid reply');
        assert.equal(error.statusCode, 502);
        return true;
      }
    );
    assert.equal(executeCalled, false);
  } finally {
    LLMClientFactory.create = originalCreate;
    parseDouyinVideoTool.execute = originalExecute;
  }
});

test('AISessionStore 应生成会话、记录历史并按轮次裁剪', () => {
  const store = new AISessionStore({
    sessionLimit: 2,
    sessionIdFactory: () => 'session-new'
  });

  const firstContext = store.createContext('  第一轮问题  ');
  assert.equal(firstContext.resolvedSessionId, 'session-new');
  assert.deepEqual(firstContext.history, []);
  assert.deepEqual(firstContext.userMessage, { role: 'user', content: '第一轮问题' });

  store.saveTurn(firstContext.resolvedSessionId, firstContext.userMessage, '第一轮回答');
  store.saveTurn(firstContext.resolvedSessionId, { role: 'user', content: '第二轮问题' }, '第二轮回答');
  store.saveTurn(firstContext.resolvedSessionId, { role: 'user', content: '第三轮问题' }, '第三轮回答');

  assert.deepEqual(store.getMessages('session-new'), [
    { role: 'user', content: '第二轮问题' },
    { role: 'assistant', content: '第二轮回答' },
    { role: 'user', content: '第三轮问题' },
    { role: 'assistant', content: '第三轮回答' }
  ]);
});

test('AISessionStore 返回的 history 与 messages 不应污染内部状态', () => {
  const store = new AISessionStore({
    sessionLimit: 2
  });
  const sessionId = 'session-isolation';

  store.saveTurn(sessionId, { role: 'user', content: '第一轮问题' }, '第一轮回答');

  const messages = store.getMessages(sessionId);
  messages.push({ role: 'user', content: '外部新增' });
  messages[0].content = '外部篡改';

  const context = store.createContext('第二轮问题', sessionId);
  context.history.pop();
  context.history[0].content = '再次篡改';

  assert.deepEqual(store.getMessages(sessionId), [
    { role: 'user', content: '第一轮问题' },
    { role: 'assistant', content: '第一轮回答' }
  ]);
});

test('messageNormalizer 应拆分 think/reply、过滤供应商标记并在 reply 为空时生成回退文案', () => {
  const normalized = normalizeAssistantReply(
    '<think>这是思考</think><minimax:tool_call>\n<invoke name="tool">\n</invoke>\n</minimax:tool_call>',
    {
      title: '测试标题',
      author: '测试作者',
      audioReady: false
    }
  );

  assert.equal(normalized.thinking, '这是思考');
  assert.equal(normalized.reply, '解析成功，标题：测试标题，作者：测试作者。当前没有可直接使用的音频直链，但仍可尝试提取音频。');
});
