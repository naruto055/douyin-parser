const test = require('node:test');
const assert = require('node:assert/strict');

const createChatRuntime = require('../ai/runtime/createChatRuntime');

test('createChatRuntime.run 应通过 provider.generate 执行 tool calling 并提取 parsedData', async () => {
  const generateCalls = [];
  const runtime = createChatRuntime({
    provider: {
      async generate(input) {
        generateCalls.push(input);

        if (generateCalls.length === 1) {
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

        return {
          content: '<think>思考</think>最终回复',
          toolCalls: []
        };
      }
    },
    registry: {
      definitions: [{ legacy: true }],
      toolsByName: {
        parse_douyin_video: {
          name: 'parse_douyin_video',
          async execute(input) {
            return {
              title: '测试视频',
              author: '测试作者',
              shareUrl: input.url,
              audioReady: true
            };
          }
        }
      }
    }
  });

  const result = await runtime.run({
    history: [],
    userMessage: { role: 'user', content: 'hello' }
  });

  assert.equal(generateCalls.length, 2);
  assert.deepEqual(generateCalls[0], {
    messages: [
      { role: 'system', content: generateCalls[0].messages[0].content },
      { role: 'user', content: 'hello' }
    ],
    tools: [{ legacy: true }],
    toolChoice: 'auto'
  });
  assert.deepEqual(generateCalls[1].messages.at(-2), {
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        id: 'tool-1',
        type: 'function',
        function: {
          name: 'parse_douyin_video',
          arguments: '{"url":"https://v.douyin.com/tool"}'
        }
      }
    ]
  });
  assert.equal(generateCalls[1].messages.at(-1).role, 'tool');
  assert.equal(generateCalls[1].messages.at(-1).name, 'parse_douyin_video');
  assert.equal(generateCalls[1].messages.at(-1).tool_call_id, 'tool-1');
  assert.equal(result.content, '<think>思考</think>最终回复');
  assert.equal(result.parsedData.shareUrl, 'https://v.douyin.com/tool');
});

test('createChatRuntime.runStream 应通过 provider.streamGenerate 输出 tool_result 与 content_delta', async () => {
  const runtimeEvents = [];
  const streamCalls = [];
  const generateCalls = [];
  const runtime = createChatRuntime({
    provider: {
      async *streamGenerate(input) {
        streamCalls.push(input);
        yield {
          type: 'tool_call',
          toolCall: {
            id: 'tool-stream-1',
            type: 'function',
            name: 'parse_douyin_video',
            arguments: '{"url":"https://v.douyin.com/stream"}'
          }
        };
      },
      async generate(input) {
        generateCalls.push(input);
        return {
          content: '<think>流式思考</think>流式回复',
          toolCalls: []
        };
      }
    },
    registry: {
      definitions: [{ legacy: true }],
      toolsByName: {
        parse_douyin_video: {
          name: 'parse_douyin_video',
          async execute(input) {
            return {
              title: '流式视频',
              author: '流式作者',
              shareUrl: input.url,
              audioReady: false
            };
          }
        }
      }
    }
  });

  const result = await runtime.runStream({
    history: [],
    userMessage: { role: 'user', content: 'hello' },
    onRuntimeEvent(event) {
      runtimeEvents.push(event);
    }
  });

  assert.equal(result.content, '<think>流式思考</think>流式回复');
  assert.equal(result.parsedData.shareUrl, 'https://v.douyin.com/stream');
  assert.equal(streamCalls.length, 1);
  assert.equal(generateCalls.length, 1);
  assert.deepEqual(generateCalls[0].messages.at(-2), {
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        id: 'tool-stream-1',
        type: 'function',
        function: {
          name: 'parse_douyin_video',
          arguments: '{"url":"https://v.douyin.com/stream"}'
        }
      }
    ]
  });
  assert.equal(generateCalls[0].messages.at(-1).role, 'tool');
  assert.equal(generateCalls[0].messages.at(-1).name, 'parse_douyin_video');
  assert.equal(generateCalls[0].messages.at(-1).tool_call_id, 'tool-stream-1');
  assert.deepEqual(runtimeEvents, [
    {
      type: 'progress',
      stage: 'model_start',
      message: 'AI 正在分析输入'
    },
    {
      type: 'tool_result',
      parsedData: {
        title: '流式视频',
        author: '流式作者',
        shareUrl: 'https://v.douyin.com/stream',
        audioReady: false
      }
    },
    {
      type: 'content_delta',
      delta: '<think>流式思考</think>流式回复'
    }
  ]);
});
