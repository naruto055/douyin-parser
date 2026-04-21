const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../config');
const AIChatService = require('../services/AIChatService');
const LLMClientFactory = require('../services/llm/LLMClientFactory');
const parseDouyinVideoTool = require('../services/tools/parseDouyinVideoTool');

test('AIChatService 在工具调用场景下返回 thinking、reply 和 parsedData', async () => {
  const originalCreate = LLMClientFactory.create;
  const originalExecute = parseDouyinVideoTool.execute;

  let callCount = 0;
  LLMClientFactory.create = () => ({
    getName: () => 'openai-compatible',
    generate: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'parse_douyin_video',
              arguments: '{"url":"https://v.douyin.com/tool"}'
            }
          ]
        };
      }

      return {
        content: '<think>这是工具调用后的思考</think>解析成功，标题是测试视频。',
        toolCalls: []
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

  let callCount = 0;
  LLMClientFactory.create = () => ({
    getName: () => 'openai-compatible',
    generate: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          content: '',
          toolCalls: []
        };
      }

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

  let callCount = 0;
  LLMClientFactory.create = () => ({
    getName: () => 'openai-compatible',
    generate: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          content: '',
          toolCalls: []
        };
      }

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

  LLMClientFactory.create = () => ({
    getName: () => 'openai-compatible',
    generate: async () => ({
      content: '你好，我可以帮你解析抖音链接。',
      toolCalls: []
    })
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

  LLMClientFactory.create = () => ({
    getName: () => 'openai-compatible',
    generate: async ({ messages }) => {
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
