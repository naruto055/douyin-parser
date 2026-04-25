const rateLimit = require('express-rate-limit');
const config = require('../config');
const ErrorCodes = require('../errors/errorCodes');

/**
 * 通用 API 限流中间件。
 *
 * 作用：限制普通接口在指定时间窗口内的请求次数，超过阈值时返回统一的限流响应。
 * 用法：在路由或应用入口中挂载 `apiLimiter`，例如 `app.use('/api', apiLimiter)`。
 */
const apiLimiter = rateLimit({
  // 限流统计窗口时长，来自全局 rateLimit 配置。
  windowMs: config.rateLimit.windowMs,
  // 单个客户端在统计窗口内允许的最大请求次数。
  max: config.rateLimit.max,
  // 触发限流时返回给客户端的统一响应体。
  message: {
    success: false,
    code: ErrorCodes.RATE_LIMITED,
    message: 'Too many requests, please try again later',
    data: null
  },
  // 返回标准限流响应头，便于客户端识别剩余次数和重置时间。
  standardHeaders: true,
  // 关闭旧版 X-RateLimit-* 响应头，避免重复输出限流信息。
  legacyHeaders: false,
  /**
   * 生成限流键。
   *
   * 作用：按客户端 IP 聚合请求次数；优先使用 Express 解析后的 `req.ip`，
   * 再依次回退到代理头和底层连接地址，兼容不同部署环境。
   */
  keyGenerator: (req) => {
    return req.ip ||
      req.headers['x-forwarded-for'] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      (req.connection.socket ? req.connection.socket.remoteAddress : null);
  }
});

/**
 * AI 接口限流中间件。
 *
 * 作用：限制 AI 相关接口的请求频率，避免模型调用被高频请求占满。
 * 用法：在 AI 路由上挂载 `aiLimiter`，例如 `router.use(aiLimiter)`。
 */
const aiLimiter = rateLimit({
  // AI 接口限流统计窗口时长，来自 AI 专用配置。
  windowMs: config.ai.rateLimit.windowMs,
  // 单个客户端在 AI 限流窗口内允许的最大请求次数。
  max: config.ai.rateLimit.max,
  // 触发 AI 限流时返回给客户端的统一响应体。
  message: {
    success: false,
    code: ErrorCodes.RATE_LIMITED,
    message: 'AI requests are too frequent, please try again later',
    data: null
  },
  // 返回标准限流响应头，便于客户端识别剩余次数和重置时间。
  standardHeaders: true,
  // 关闭旧版 X-RateLimit-* 响应头，避免重复输出限流信息。
  legacyHeaders: false,
  /**
   * 生成 AI 限流键。
   *
   * 作用：按客户端 IP 聚合 AI 请求次数；优先使用 Express 解析后的 `req.ip`，
   * 再依次回退到代理头和底层连接地址，兼容不同部署环境。
   */
  keyGenerator: (req) => {
    return req.ip ||
      req.headers['x-forwarded-for'] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      (req.connection.socket ? req.connection.socket.remoteAddress : null);
  }
});

module.exports = {
  apiLimiter,
  aiLimiter
};