const HEARTBEAT_INTERVAL_MS = 15000;

function initializeSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const heartbeatTimer = setInterval(() => {
    if (res.writableEnded) {
      return;
    }

    res.write(': keep-alive\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  return () => {
    clearInterval(heartbeatTimer);
  };
}

function writeSSEEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function closeSSE(res, cleanup) {
  cleanup?.();

  if (!res.writableEnded) {
    res.end();
  }
}

module.exports = {
  initializeSSE,
  writeSSEEvent,
  closeSSE
};
