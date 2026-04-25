const AppError = require('../errors/AppError');
const ErrorCodes = require('../errors/errorCodes');
const response = require('../utils/response');

/**
 * 全局错误处理中间件。
 *
 * 文件作用：集中处理 Express 路由、中间件和服务层向外抛出的错误，
 * 将不同来源的异常统一转换成项目标准响应结构：
 * `{ success: false, code, message, data }`。
 *
 * 使用方式：在 app.js 中应放在所有路由之后注册，例如：
 * `app.use(errorHandler)`。
 *
 * Express 识别错误处理中间件依赖四个参数签名：
 * `(err, req, res, next)`，因此即使当前没有直接使用 `req` 和 `next`，
 * 也需要保留它们，避免 Express 把该函数当成普通中间件。
 */

/**
 * 根据 HTTP 状态码映射项目业务错误码。
 *
 * 作用：处理非 AppError 类型但带有 HTTP 状态码的错误，
 * 例如第三方中间件或 Express 自身产生的 400、429 等错误。
 *
 * @param {number} statusCode HTTP 状态码。
 * @returns {string|number} 项目内部统一错误码。
 */
function getErrorCodeByStatus(statusCode) {
  // 请求参数或请求体格式不合法时，统一归类为参数校验错误。
  if (statusCode === 400) return ErrorCodes.VALIDATION_ERROR;

  // 请求频率超过限制时，统一归类为限流错误。
  if (statusCode === 429) return ErrorCodes.RATE_LIMITED;

  // 其他未知 HTTP 错误默认归类为服务内部错误，避免暴露过多细节。
  return ErrorCodes.INTERNAL_ERROR;
}

/**
 * Express 全局错误处理函数。
 *
 * 作用：作为应用最后一道错误处理入口，接收 `next(error)` 传递的异常，
 * 根据错误类型生成统一失败响应。
 *
 * 处理规则：
 * 1. AppError：使用业务层明确声明的 code、message、data 和 HTTP 状态码。
 * 2. 带 status/statusCode 的普通错误：按 HTTP 状态码映射业务错误码。
 * 3. 未知错误：返回 500 和 INTERNAL_ERROR。
 *
 * @param {Error|AppError} err Express 捕获到的错误对象。
 * @param {import('express').Request} req Express 请求对象，保留用于符合错误中间件签名。
 * @param {import('express').Response} res Express 响应对象。
 * @param {import('express').NextFunction} next Express 下一个中间件函数，保留用于符合错误中间件签名。
 * @returns {import('express').Response} 统一失败响应。
 */
function errorHandler(err, req, res, next) {
  // 记录原始错误，便于服务端排查问题；客户端响应会在下面统一脱敏处理。
  console.error('Error:', err);

  // AppError 是项目主动抛出的应用错误，包含明确的业务错误码、消息和附加数据。
  if (err instanceof AppError) {
    // 业务错误保持 HTTP 200，以兼容现有接口契约；非业务错误使用错误对象携带的 HTTP 状态码。
    const httpStatus = err.isBusiness ? 200 : err.httpStatus;
    return response.fail(res, err.code, err.message, err.data, httpStatus);
  }

  // 兼容 Express 或第三方中间件常见的 statusCode/status 字段。
  const statusCode = err.statusCode || err.status;
  if (statusCode) {
    // 将 HTTP 状态码转换为项目错误码，同时保留原始 HTTP 状态码返回给客户端。
    return response.fail(res, getErrorCodeByStatus(statusCode), err.message || 'Internal Server Error', null, statusCode);
  }

  // 兜底处理未知异常，避免未捕获错误导致请求悬挂或返回非统一格式。
  return response.fail(res, ErrorCodes.INTERNAL_ERROR, 'Internal Server Error', null, 500);
}

module.exports = errorHandler;