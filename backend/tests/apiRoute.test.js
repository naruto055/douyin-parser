const test = require('node:test');
const assert = require('node:assert/strict');

const ErrorCodes = require('../errors/errorCodes');
const errorHandler = require('../middleware/errorHandler');
const apiRouter = require('../routes/api');
const VideoService = require('../services/VideoService');

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

function getRouteHandler(path, method) {
  const layer = apiRouter.stack.find((item) => item.route && item.route.path === path && item.route.methods[method]);
  return layer.route.stack[0].handle;
}

test('解析路由在服务失败时返回业务错误码', async () => {
  const originalParseVideo = VideoService.parseVideo;
  const handler = getRouteHandler('/parse', 'post');

  VideoService.parseVideo = async () => {
    throw new Error('parse failed');
  };

  try {
    const req = { body: { url: 'https://v.douyin.com/test' } };
    const res = createResponse();

    await handler(req, res, (error) => errorHandler(error, req, res, () => {}));

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, false);
    assert.equal(res.payload.code, ErrorCodes.PARSE_FAILED);
    assert.equal(res.payload.message, 'parse failed');
    assert.equal(res.payload.data, null);
  } finally {
    VideoService.parseVideo = originalParseVideo;
  }
});
