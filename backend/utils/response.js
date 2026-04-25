const ErrorCodes = require('../errors/errorCodes');

/**
 * 返回统一的成功响应。
 *
 * 用法：在路由或控制器中调用 `ok(res, data, message)`，会以 HTTP 200
 * 返回 `{ success: true, code, message, data }` 格式的 JSON 数据。
 *
 * @param {import('express').Response} res Express 响应对象。
 * @param {*} [data=null] 响应数据，默认返回 null。
 * @param {string} [message='success'] 响应消息，默认返回 success。
 * @returns {import('express').Response} Express 响应结果。
 */
function ok(res, data = null, message = 'success') {
  return res.status(200).json({
    success: true,
    code: ErrorCodes.OK,
    message,
    data
  });
}

/**
 * 返回统一的失败响应。
 *
 * 用法：在业务校验失败或异常处理中调用 `fail(res, code, message, data, httpStatus)`，
 * 会返回 `{ success: false, code, message, data }` 格式的 JSON 数据。
 *
 * @param {import('express').Response} res Express 响应对象。
 * @param {string|number} code 业务错误码，通常来自 ErrorCodes。
 * @param {string} message 错误消息，用于说明失败原因。
 * @param {*} [data=null] 附加错误数据，默认返回 null。
 * @param {number} [httpStatus=200] HTTP 状态码，默认保持兼容返回 200。
 * @returns {import('express').Response} Express 响应结果。
 */
function fail(res, code, message, data = null, httpStatus = 200) {
  return res.status(httpStatus).json({
    success: false,
    code,
    message,
    data
  });
}

module.exports = {
  ok,
  fail
};
