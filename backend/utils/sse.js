const HEARTBEAT_INTERVAL_MS = 15000;

/**
 * 初始化 SSE 响应头与心跳保活逻辑。
 *
 * @param {import('http').ServerResponse} res HTTP 响应对象
 * @returns {() => void} 清理函数，用于停止心跳定时器
 */
function initializeSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // 立即将响应头刷出，避免客户端长时间等待连接建立。
  res.flushHeaders?.();

  const heartbeatTimer = setInterval(() => {
    if (res.writableEnded) {
      return;
    }

    // SSE 注释行不会被客户端消费，但可以防止中间链路主动断开空闲连接。
    res.write(': keep-alive\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  return () => {
    clearInterval(heartbeatTimer);
  };
}

/**
 * 向客户端写入一条标准 SSE 事件。
 *
 * @param {import('http').ServerResponse} res HTTP 响应对象
 * @param {string} event 事件名称
 * @param {any} payload 事件数据
 */
function writeSSEEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * 关闭 SSE 连接，并执行外部清理逻辑。
 *
 * @param {import('http').ServerResponse} res HTTP 响应对象
 * @param {(() => void) | undefined} cleanup 初始化阶段返回的清理函数
 */
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
