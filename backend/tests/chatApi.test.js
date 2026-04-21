const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApiUrl } = require('../public/chatApi');

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
