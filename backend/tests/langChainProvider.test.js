const test = require('node:test');
const assert = require('node:assert/strict');
const { AIMessage, AIMessageChunk } = require('@langchain/core/messages');

const createChatModel = require('../ai/infra/model/createChatModel');
const LangChainProvider = require('../ai/infra/model/LangChainProvider');

test('createChatModel 能正确映射配置字段到 ChatOpenAI', () => {
  const captured = [];
  class FakeChatOpenAI {
    constructor(options) {
      captured.push(options);
      this.options = options;
    }
  }

  const model = createChatModel(
    {
      apiKey: 'test-key',
      baseURL: 'https://example.com/v1',
      model: 'gpt-test',
      temperature: 0.35,
      maxTokens: 321,
      requestTimeoutMs: 4567
    },
    { ChatOpenAI: FakeChatOpenAI }
  );

  assert.ok(model instanceof FakeChatOpenAI);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].apiKey, 'test-key');
  assert.equal(captured[0].model, 'gpt-test');
  assert.equal(captured[0].temperature, 0.35);
  assert.equal(captured[0].maxTokens, 321);
  assert.equal(captured[0].streamUsage, false);
  assert.equal(captured[0].timeout, 4567);
  assert.equal(captured[0].configuration.baseURL, 'https://example.com/v1');
});

test('LangChainProvider.generate 能归一化 content 与 toolCalls', async () => {
  const invokeCalls = [];
  const bindCalls = [];
  const fakeRunnable = {
    invoke: async (messages) => {
      invokeCalls.push(messages);
      return {
        content: [{ type: 'text', text: '已收到请求' }, { text: '继续处理' }],
        tool_calls: [
          {
            id: 'tool-1',
            type: 'tool_call',
            name: 'parse_douyin_video',
            args: { url: 'https://v.douyin.com/test' }
          }
        ]
      };
    }
  };
  const fakeModel = {
    bindTools: (tools, options) => {
      bindCalls.push({ tools, options });
      return fakeRunnable;
    },
    invoke: fakeRunnable.invoke
  };

  const provider = new LangChainProvider(
    {
      provider: 'openai-compatible',
      apiKey: 'test-key'
    },
    { model: fakeModel }
  );

  const tools = [
    {
      name: 'parse_douyin_video'
    }
  ];
  const result = await provider.generate({
    messages: [{ role: 'user', content: 'test' }],
    tools,
    toolChoice: 'auto'
  });

  assert.equal(bindCalls.length, 1);
  assert.deepEqual(bindCalls[0], {
    tools,
    options: { tool_choice: 'auto' }
  });
  assert.equal(invokeCalls.length, 1);
  assert.equal(result.content, '已收到请求\n继续处理');
  assert.deepEqual(result.toolCalls, [
    {
      id: 'tool-1',
      type: 'function',
      name: 'parse_douyin_video',
      arguments: '{"url":"https://v.douyin.com/test"}'
    }
  ]);
});

test('LangChainProvider.streamGenerate 能产出 content_delta 事件', async () => {
  const fakeModel = {
    stream: async function* () {
      yield { content: '' };
      yield { content: [{ type: 'text', text: '<think>先解析</think>' }] };
      yield { content: '解析成功' };
    }
  };
  const provider = new LangChainProvider(
    {
      provider: 'openai-compatible',
      apiKey: 'test-key'
    },
    { model: fakeModel }
  );

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

test('LangChainProvider 能兼容 LangChain 原生消息结构', async () => {
  const provider = new LangChainProvider(
    {
      provider: 'openai-compatible',
      apiKey: 'test-key'
    },
    {
      model: {
        invoke: async () =>
          new AIMessage({
            content: '真实消息',
            tool_calls: [
              {
                id: 'tool-2',
                name: 'parse_douyin_video',
                args: { url: 'https://v.douyin.com/native' },
                type: 'tool_call'
              }
            ]
          }),
        stream: async function* () {
          yield new AIMessageChunk({ content: '<think>原生分片</think>' });
          yield new AIMessageChunk({ content: '最终回复' });
        }
      }
    }
  );

  const generated = await provider.generate({
    messages: [{ role: 'user', content: 'hello' }],
    tools: []
  });
  const streamed = [];

  for await (const event of provider.streamGenerate({
    messages: [{ role: 'user', content: 'hello' }],
    tools: []
  })) {
    streamed.push(event);
  }

  assert.equal(generated.content, '真实消息');
  assert.deepEqual(generated.toolCalls, [
    {
      id: 'tool-2',
      type: 'function',
      name: 'parse_douyin_video',
      arguments: '{"url":"https://v.douyin.com/native"}'
    }
  ]);
  assert.deepEqual(streamed, [
    { type: 'content_delta', delta: '<think>原生分片</think>' },
    { type: 'content_delta', delta: '最终回复' }
  ]);
});

test('缺少 apiKey 或 model 时错误语义稳定', () => {
  assert.throws(
    () =>
      createChatModel(
        {
          apiKey: '',
          baseURL: 'https://example.com/v1',
          model: 'gpt-test'
        },
        { ChatOpenAI: class {} }
      ),
    (error) => {
      assert.equal(error.message, 'LLM API key is not configured');
      assert.equal(error.statusCode, 500);
      return true;
    }
  );

  assert.throws(
    () => new LangChainProvider({ provider: 'openai-compatible' }, { model: {} }),
    (error) => {
      assert.equal(error.message, 'LLM API key is not configured');
      assert.equal(error.statusCode, 500);
      return true;
    }
  );

  assert.throws(
    () => new LangChainProvider({ provider: 'openai-compatible', apiKey: 'test-key' }, {}),
    (error) => {
      assert.equal(error.message, 'LangChain provider requires a chat model');
      assert.equal(error.statusCode, 500);
      return true;
    }
  );
});
