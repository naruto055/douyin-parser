const express = require('express');

const AIChatService = require('../services/AIChatService');
const { aiLimiter } = require('../middleware/rateLimit');
const { initializeSSE, writeSSEEvent, closeSSE } = require('../utils/sse');
const AppError = require('../errors/AppError');
const ErrorCodes = require('../errors/errorCodes');
const response = require('../utils/response');

// 创建 AI 路由实例，用于注册 AI 相关 HTTP 接口。
const router = express.Router();

/**
 * 普通 AI 对话接口。
 *
 * 作用：接收用户输入的 message 和可选 sessionId，调用 AIChatService.chat 生成完整回复。
 * 用法：客户端通过 POST /chat 提交 JSON 请求体，例如 `{ "message": "你好", "sessionId": "xxx" }`。
 * 中间件链：请求会先经过 aiLimiter，通过限流检查后才会进入后面的异步路由处理函数。
 */
router.post('/chat', aiLimiter, async (req, res, next) => {
  try {
    // 从请求体中读取用户消息和会话 ID；req.body 为空时使用空对象避免解构报错。
    const { message, sessionId } = req.body || {};

    // message 是 AI 对话的必填参数，缺失时直接返回 400 校验错误。
    if (!message) {
      return response.fail(res, ErrorCodes.VALIDATION_ERROR, 'message is required', null, 400);
    }

    // 调用业务服务生成普通 JSON 响应格式的 AI 回复。
    const data = await AIChatService.chat(message, sessionId);
    return response.ok(res, data);
  } catch (error) {
    // 将未知异常包装为应用错误，交给全局错误处理中间件统一响应。
    return next(new AppError({
      code: ErrorCodes.AI_CHAT_FAILED,
      message: error.message || 'AI chat failed'
    }));
  }
});

/**
 * 流式 AI 对话接口。
 *
 * 作用：接收用户输入后建立 SSE 连接，把 AI 生成过程中的事件持续写回客户端。
 * 用法：客户端通过 POST /chat/stream 提交 JSON 请求体，并按 Server-Sent Events 格式读取响应。
 * 中间件链：请求会先经过 aiLimiter，通过限流检查后才会进入 SSE 初始化和流式处理逻辑。
 */
router.post('/chat/stream', aiLimiter, async (req, res) => {
  // 从请求体中读取用户消息和会话 ID；req.body 为空时使用空对象避免解构报错。
  const { message, sessionId } = req.body || {};

  // 流式对话同样要求 message 必填；缺失时不建立 SSE，直接返回校验错误。
  if (!message) {
    return response.fail(res, ErrorCodes.VALIDATION_ERROR, 'message is required', null, 400);
  }

  // 初始化 SSE 响应头和心跳，返回清理心跳定时器的函数。
  const cleanupHeartbeat = initializeSSE(res);
  req.on('close', () => {
    // 客户端断开连接时关闭 SSE，并清理心跳资源。
    closeSSE(res, cleanupHeartbeat);
  });

  try {
    await AIChatService.chatStream(message, sessionId, {
      /**
       * 写入单个 SSE 事件。
       *
       * 作用：把 AIChatService 产生的事件名和载荷转换为 SSE 数据写回客户端。
       */
      onEvent(event, payload) {
        writeSSEEvent(res, event, payload);
      }
    });
  } catch (error) {
    // 流式响应已经开始后不能再返回普通 JSON，因此通过 SSE error 事件通知客户端。
    writeSSEEvent(res, 'error', {
      error: error.message || 'AI stream failed'
    });
  } finally {
    // 无论正常结束还是异常结束，都关闭 SSE 并释放心跳资源。
    closeSSE(res, cleanupHeartbeat);
  }
});

module.exports = router;