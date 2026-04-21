const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApiUrl, parseSSEChunk } = require('../public/chatApi');

test('buildApiUrl 在 file 协议下回退到本地后端地址', () => {
  const url = buildApiUrl('/api/ai/chat', {
    protocol: 'file:',
    origin: 'null'
  });

  assert.equal(url, 'http://localhost:3000/api/ai/chat');
});

test('buildApiUrl 在 http 协议下保留相对地址语义', () => {
  const url = buildApiUrl('/api/ai/chat', {
    protocol: 'http:',
    origin: 'http://localhost:3000'
  });

  assert.equal(url, 'http://localhost:3000/api/ai/chat');
});

test('parseSSEChunk 解析 event 与 data 片段', () => {
  const events = parseSSEChunk('event: reply_delta\ndata: {"delta":"你好"}\n\n');

  assert.deepEqual(events, [
    {
      event: 'reply_delta',
      data: { delta: '你好' }
    }
  ]);
});
