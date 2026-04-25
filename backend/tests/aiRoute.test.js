const test = require('node:test');
const assert = require('node:assert/strict');

const AIChatService = require('../services/AIChatService');
const aiRouter = require('../routes/ai');
const ErrorCodes = require('../errors/errorCodes');
const errorHandler = require('../middleware/errorHandler');

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
  assert.equal(res.payload.success, false);
  assert.equal(res.payload.code, ErrorCodes.VALIDATION_ERROR);
  assert.equal(res.payload.message, 'message is required');
  assert.equal(res.payload.data, null);
});

test('AI 路由在成功时返回统一结构', async () => {
  const originalChat = AIChatService.chat;
  const layer = aiRouter.stack.find((item) => item.route && item.route.path === '/chat');
  const handler = layer.route.stack[1].handle;

  AIChatService.chat = async () => ({
    thinking: '思考内容',
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
    assert.equal(res.payload.code, ErrorCodes.OK);
    assert.equal(res.payload.message, 'success');
    assert.equal(res.payload.data.thinking, '思考内容');
    assert.equal(res.payload.data.reply, 'ok');
  } finally {
    AIChatService.chat = originalChat;
  }
});

test('AI 路由在服务失败时返回业务错误码', async () => {
  const originalChat = AIChatService.chat;
  const layer = aiRouter.stack.find((item) => item.route && item.route.path === '/chat');
  const handler = layer.route.stack[1].handle;

  AIChatService.chat = async () => {
    throw new Error('LLM API key is not configured');
  };

  try {
    const req = { body: { message: 'hello' } };
    const res = createResponse();

    await handler(req, res, (error) => errorHandler(error, req, res, () => {}));

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, false);
    assert.equal(res.payload.code, ErrorCodes.AI_CHAT_FAILED);
    assert.equal(res.payload.message, 'LLM API key is not configured');
    assert.equal(res.payload.data, null);
  } finally {
    AIChatService.chat = originalChat;
  }
});
