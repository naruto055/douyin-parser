const rateLimit = require('express-rate-limit');
const config = require('../config');

const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: {
    success: false,
    error: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip ||
      req.headers['x-forwarded-for'] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      (req.connection.socket ? req.connection.socket.remoteAddress : null);
  }
});

const aiLimiter = rateLimit({
  windowMs: config.ai.rateLimit.windowMs,
  max: config.ai.rateLimit.max,
  message: {
    success: false,
    error: 'AI requests are too frequent, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
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
