const test = require('node:test');
const assert = require('node:assert/strict');

const AppError = require('../errors/AppError');
const ErrorCodes = require('../errors/errorCodes');
const response = require('../utils/response');
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

test('AppError 默认表示业务异常并使用 HTTP 200', () => {
  const error = new AppError({
    code: ErrorCodes.PARSE_FAILED,
    message: '视频解析失败'
  });

  assert.equal(error.name, 'AppError');
  assert.equal(error.code, ErrorCodes.PARSE_FAILED);
  assert.equal(error.message, '视频解析失败');
  assert.equal(error.httpStatus, 200);
  assert.equal(error.data, null);
  assert.equal(error.isBusiness, true);
});

test('AppError 支持非业务异常状态码', () => {
  const error = new AppError({
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'url is required',
    httpStatus: 400,
    isBusiness: false,
    data: { field: 'url' }
  });

  assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
  assert.equal(error.httpStatus, 400);
  assert.equal(error.isBusiness, false);
  assert.deepEqual(error.data, { field: 'url' });
});

test('response.ok 返回统一成功结构', () => {
  const res = createResponse();

  response.ok(res, { id: 1 });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    success: true,
    code: ErrorCodes.OK,
    message: 'success',
    data: { id: 1 }
  });
});

test('response.fail 默认以 HTTP 200 返回业务失败结构', () => {
  const res = createResponse();

  response.fail(res, ErrorCodes.PARSE_FAILED, '视频解析失败');

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    success: false,
    code: ErrorCodes.PARSE_FAILED,
    message: '视频解析失败',
    data: null
  });
});

test('response.fail 支持非业务 HTTP 状态码', () => {
  const res = createResponse();

  response.fail(res, ErrorCodes.VALIDATION_ERROR, 'url is required', { field: 'url' }, 400);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, {
    success: false,
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'url is required',
    data: { field: 'url' }
  });
});

test('errorHandler 将业务 AppError 转为 HTTP 200 统一失败响应', () => {
  const res = createResponse();
  const error = new AppError({
    code: ErrorCodes.PARSE_FAILED,
    message: '视频解析失败'
  });

  errorHandler(error, {}, res, () => {});

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    success: false,
    code: ErrorCodes.PARSE_FAILED,
    message: '视频解析失败',
    data: null
  });
});

test('errorHandler 将非业务 AppError 转为指定 HTTP 状态码', () => {
  const res = createResponse();
  const error = new AppError({
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'url is required',
    httpStatus: 400,
    isBusiness: false
  });

  errorHandler(error, {}, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, {
    success: false,
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'url is required',
    data: null
  });
});

test('errorHandler 将未知异常转为 HTTP 500', () => {
  const res = createResponse();

  errorHandler(new Error('boom'), {}, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.payload, {
    success: false,
    code: ErrorCodes.INTERNAL_ERROR,
    message: 'Internal Server Error',
    data: null
  });
});

test('errorHandler 保留普通错误对象上的 HTTP 状态码', () => {
  const res = createResponse();
  const error = new Error('Bad Request');
  error.statusCode = 400;

  errorHandler(error, {}, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, {
    success: false,
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'Bad Request',
    data: null
  });
});
