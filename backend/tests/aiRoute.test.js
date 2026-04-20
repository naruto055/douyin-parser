const test = require('node:test');
const assert = require('node:assert/strict');

const AIChatService = require('../services/AIChatService');
const aiRouter = require('../routes/ai');

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    }
  };
}

test('AI 路由在缺少 message 时返回 400', async () => {
  const layer = aiRouter.stack.find((item) => item.route && item.route.path === '/chat');
  const handler = layer.route.stack[1].handle;

  const req = { body: {} };
  const res = createResponse();

  await handler(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, 'message is required');
});

test('AI 路由在成功时返回统一结构', async () => {
  const originalChat = AIChatService.chat;
  const layer = aiRouter.stack.find((item) => item.route && item.route.path === '/chat');
  const handler = layer.route.stack[1].handle;

  AIChatService.chat = async () => ({
    reply: 'ok',
    sessionId: 'session-1',
    parsedData: { title: 'demo' }
  });

  try {
    const req = { body: { message: 'hello' } };
    const res = createResponse();

    await handler(req, res, (error) => {
      throw error;
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.data.reply, 'ok');
  } finally {
    AIChatService.chat = originalChat;
  }
});
