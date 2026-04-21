const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeSSE, closeSSE } = require('../utils/sse');

function createResponse() {
  return {
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
    end() {
      this.writableEnded = true;
    }
  };
}

test('initializeSSE 启用心跳并在关闭时停止', () => {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const res = createResponse();
  const timers = [];
  const cleared = [];

  global.setInterval = (handler, delay) => {
    const timer = { handler, delay };
    timers.push(timer);
    return timer;
  };
  global.clearInterval = (timer) => {
    cleared.push(timer);
  };

  try {
    const heartbeat = initializeSSE(res);

    assert.equal(typeof heartbeat, 'function');
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 15000);

    timers[0].handler();
    assert.match(res.chunks.join(''), /: keep-alive/);

    closeSSE(res, heartbeat);
    assert.equal(cleared.length, 1);
    assert.equal(res.writableEnded, true);
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
});
