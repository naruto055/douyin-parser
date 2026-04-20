const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../config');
const AIChatService = require('../services/AIChatService');
const LLMClientFactory = require('../services/llm/LLMClientFactory');
const parseDouyinVideoTool = require('../services/tools/parseDouyinVideoTool');

test('AIChatService 在工具调用场景下返回 reply 和 parsedData', async () => {
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
        content: '解析成功，标题是测试视频。',
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

    assert.equal(result.reply, '解析成功，标题是测试视频。');
    assert.equal(result.parsedData.shareUrl, 'https://v.douyin.com/tool');
  } finally {
    LLMClientFactory.create = originalCreate;
    parseDouyinVideoTool.execute = originalExecute;
  }
});

test('AIChatService 在模型未返回工具调用时走后端降级路径', async () => {
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
        content: '已根据解析结果为你整理完成。',
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

    assert.equal(result.reply, '已根据解析结果为你整理完成。');
    assert.equal(result.parsedData.audioReady, false);
  } finally {
    LLMClientFactory.create = originalCreate;
    parseDouyinVideoTool.execute = originalExecute;
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
