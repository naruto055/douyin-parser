const test = require('node:test');
const assert = require('node:assert/strict');

const AIChatService = require('../services/AIChatService');
const aiRouter = require('../routes/ai');

function createStreamResponse() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    writableEnded: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    flushHeaders() {},
    write(chunk) {
      this.chunks.push(String(chunk));
    },
    end(chunk = '') {
      if (chunk) {
        this.chunks.push(String(chunk));
      }
      this.writableEnded = true;
    }
  };
}

function createRequest(body = {}) {
  const listeners = new Map();

  return {
    body,
    on(event, handler) {
      listeners.set(event, handler);
    },
    emit(event) {
      const handler = listeners.get(event);
      if (handler) {
        handler();
      }
    }
  };
}

test('AI SSE 路由返回 text/event-stream 并输出 session 与 done 事件', async () => {
  const originalChatStream = AIChatService.chatStream;
  const layer = aiRouter.stack.find((item) => item.route && item.route.path === '/chat/stream');
  const handler = layer.route.stack[1].handle;

  AIChatService.chatStream = async (message, sessionId, { onEvent }) => {
    onEvent('session', { sessionId: sessionId || 'session-sse' });
    onEvent('done', {
      thinking: '',
      reply: 'ok',
      sessionId: sessionId || 'session-sse',
      parsedData: null
    });
  };

  try {
    const req = createRequest({ message: 'hello' });
    const res = createStreamResponse();

    await handler(req, res, (error) => {
      throw error;
    });

    assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
    assert.match(res.chunks.join(''), /event: session/);
    assert.match(res.chunks.join(''), /event: done/);
  } finally {
    AIChatService.chatStream = originalChatStream;
  }
});

test('AI SSE 路由在服务异常时输出 error 事件并关闭连接', async () => {
  const originalChatStream = AIChatService.chatStream;
  const layer = aiRouter.stack.find((item) => item.route && item.route.path === '/chat/stream');
  const handler = layer.route.stack[1].handle;

  AIChatService.chatStream = async () => {
    throw new Error('LLM request failed');
  };

  try {
    const req = createRequest({ message: 'hello' });
    const res = createStreamResponse();

    await handler(req, res, (error) => {
      throw error;
    });

    assert.match(res.chunks.join(''), /event: error/);
    assert.equal(res.writableEnded, true);
  } finally {
    AIChatService.chatStream = originalChatStream;
  }
});

test('AI SSE 路由在客户端断开时关闭连接', async () => {
  const originalChatStream = AIChatService.chatStream;
  const layer = aiRouter.stack.find((item) => item.route && item.route.path === '/chat/stream');
  const handler = layer.route.stack[1].handle;

  AIChatService.chatStream = async () => new Promise(() => {});

  try {
    const req = createRequest({ message: 'hello' });
    const res = createStreamResponse();
    const handlerPromise = handler(req, res, (error) => {
      throw error;
    });

    req.emit('close');
    await Promise.resolve();

    assert.equal(res.writableEnded, true);

    AIChatService.chatStream = originalChatStream;
    void handlerPromise;
  } finally {
    AIChatService.chatStream = originalChatStream;
  }
});
