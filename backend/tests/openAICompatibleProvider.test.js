const test = require('node:test');
const assert = require('node:assert/strict');

const OpenAICompatibleProvider = require('../services/llm/OpenAICompatibleProvider');

test('OpenAICompatibleProvider 规范化文本与工具调用响应', async () => {
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
    choices: [
      {
        message: {
          content: '已收到请求',
          tool_calls: [
            {
              id: 'tool-1',
              type: 'function',
              function: {
                name: 'parse_douyin_video',
                arguments: '{"url":"https://v.douyin.com/test"}'
              }
            }
          ]
        }
      }
    ]
  });

  const result = await provider.generate({
    messages: [{ role: 'user', content: 'test' }],
    tools: []
  });

  assert.equal(result.content, '已收到请求');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, 'parse_douyin_video');
});

test('OpenAICompatibleProvider 在缺少 apiKey 时抛出错误', () => {
  assert.throws(() => new OpenAICompatibleProvider({}), /LLM API key is not configured/);
});
