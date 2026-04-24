const test = require('node:test');
const assert = require('node:assert/strict');

const AIChatService = require('../services/AIChatService');
const AIChatAppService = require('../ai/application/AIChatAppService');
const AIStreamAppService = require('../ai/application/AIStreamAppService');
const LLMClientFactory = require('../services/llm/LLMClientFactory');

test('AIChatService.chat 应转调 AIChatAppService.chat', async () => {
  const originalChat = AIChatAppService.chat;

  AIChatAppService.chat = async (...args) => ({
    delegated: true,
    args
  });

  try {
    const result = await AIChatService.chat('hello', 'session-app-chat');

    assert.equal(result.delegated, true);
    assert.deepEqual(result.args, ['hello', 'session-app-chat']);
  } finally {
    AIChatAppService.chat = originalChat;
  }
});

test('AIChatService.chatStream 应转调 AIStreamAppService.chatStream', async () => {
  const originalChatStream = AIStreamAppService.chatStream;
  const options = {
    onEvent() {}
  };

  AIStreamAppService.chatStream = async (...args) => ({
    delegated: true,
    args
  });

  try {
    const result = await AIChatService.chatStream('hello', 'session-app-stream', options);

    assert.equal(result.delegated, true);
    assert.deepEqual(result.args, ['hello', 'session-app-stream', options]);
  } finally {
    AIStreamAppService.chatStream = originalChatStream;
  }
});

test('AIChatAppService 应直接创建默认 provider，不再传 runtime 开关', async () => {
  const originalCreate = LLMClientFactory.create;
  const createCalls = [];

  LLMClientFactory.create = (options) => {
    createCalls.push(options);
    return {
      getName: () => 'openai-compatible',
      generate: async () => ({
        content: 'ok',
        toolCalls: []
      })
    };
  };

  try {
    const result = await AIChatAppService.chat('hello', 'runtime-chat');
    assert.equal(result.reply, 'ok');
    assert.deepEqual(createCalls, [undefined]);
  } finally {
    LLMClientFactory.create = originalCreate;
  }
});

test('AIStreamAppService 应直接创建默认 provider，不再传 runtime 开关', async () => {
  const originalCreate = LLMClientFactory.create;
  const createCalls = [];

  LLMClientFactory.create = (options) => {
    createCalls.push(options);
    return {
      getName: () => 'openai-compatible',
      streamGenerate: async function* () {
        yield {
          type: 'content_delta',
          delta: 'ok'
        };
      },
      generate: async () => ({
        content: '',
        toolCalls: []
      })
    };
  };

  try {
    const result = await AIStreamAppService.chatStream('hello', 'runtime-stream');
    assert.equal(result.reply, 'ok');
    assert.deepEqual(createCalls, [undefined]);
  } finally {
    LLMClientFactory.create = originalCreate;
  }
});
