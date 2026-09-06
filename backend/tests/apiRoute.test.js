const test = require('node:test');
const assert = require('node:assert/strict');

const AppError = require('../errors/AppError');
const ErrorCodes = require('../errors/errorCodes');
const errorHandler = require('../middleware/errorHandler');
const apiRouter = require('../routes/api');
const DownloadService = require('../services/DownloadService');
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
    assert.equal(res.payload.code, ErrorCodes.PARSE_FAILED);
    assert.equal(res.payload.message, 'parse failed');
    assert.equal(res.payload.data, null);
    assert.equal(Object.hasOwn(res.payload, 'success'), false);
  } finally {
    VideoService.parseVideo = originalParseVideo;
  }
});

test('解析路由在服务失败时返回业务错误数据', async () => {
  const originalParseVideo = VideoService.parseVideo;
  const handler = getRouteHandler('/parse', 'post');

  VideoService.parseVideo = async () => {
    const error = new Error('Puppeteer parse returned no useful data');
    error.data = {
      fallbackReason: 'Puppeteer parse returned no useful data'
    };
    throw error;
  };

  try {
    const req = {
      body: {
        url: 'https://www.douyin.com/video/123'
      }
    };
    const res = createResponse();

    await handler(req, res, (error) => errorHandler(error, req, res, () => {}));

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.code, ErrorCodes.PARSE_FAILED);
    assert.equal(res.payload.message, 'Puppeteer parse returned no useful data');
    assert.deepEqual(res.payload.data, {
      fallbackReason: 'Puppeteer parse returned no useful data'
    });
  } finally {
    VideoService.parseVideo = originalParseVideo;
  }
});

test('下载路由支持 B 站 video 下载并交给 DownloadService', async () => {
  const originalDownloadVideo = DownloadService.downloadVideo;
  const handler = getRouteHandler('/download', 'get');
  let receivedArgs = null;

  DownloadService.downloadVideo = async (...args) => {
    receivedArgs = args;
  };

  try {
    const req = {
      query: {
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1TF8G6oERL/',
        title: 'B站标题'
      }
    };
    const res = createResponse();

    await handler(req, res, () => {});

    assert.equal(receivedArgs[0], 'https://www.bilibili.com/video/BV1TF8G6oERL/');
    assert.equal(receivedArgs[1], 'B站标题');
    assert.equal(receivedArgs[2], res);
    assert.equal(res.payload, null);
  } finally {
    DownloadService.downloadVideo = originalDownloadVideo;
  }
});

test('下载路由支持 B 站 audio 下载并传递 next', async () => {
  const originalDownloadAudio = DownloadService.downloadAudio;
  const handler = getRouteHandler('/download', 'get');
  const next = () => {};
  let receivedArgs = null;

  DownloadService.downloadAudio = async (...args) => {
    receivedArgs = args;
  };

  try {
    const req = {
      query: {
        type: 'audio',
        url: 'https://www.bilibili.com/video/BV1TF8G6oERL/',
        title: 'B站标题'
      }
    };
    const res = createResponse();

    await handler(req, res, next);

    assert.equal(receivedArgs[0], 'https://www.bilibili.com/video/BV1TF8G6oERL/');
    assert.equal(receivedArgs[1], 'B站标题');
    assert.equal(receivedArgs[2], res);
    assert.equal(receivedArgs[3], next);
    assert.equal(res.payload, null);
  } finally {
    DownloadService.downloadAudio = originalDownloadAudio;
  }
});

test('下载路由透传 B 站下载业务错误给 errorHandler 包装', async () => {
  const originalDownloadVideo = DownloadService.downloadVideo;
  const handler = getRouteHandler('/download', 'get');

  DownloadService.downloadVideo = async () => {
    throw new AppError({
      code: ErrorCodes.DOWNLOAD_RESOURCE_MISSING,
      message: 'Bilibili video download requires both video and audio streams'
    });
  };

  try {
    const req = {
      query: {
        type: 'video',
        url: 'https://www.bilibili.com/video/BV1TF8G6oERL/'
      }
    };
    const res = createResponse();

    await handler(req, res, (error) => errorHandler(error, req, res, () => {}));

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.code, ErrorCodes.DOWNLOAD_RESOURCE_MISSING);
    assert.equal(res.payload.message, 'Bilibili video download requires both video and audio streams');
  } finally {
    DownloadService.downloadVideo = originalDownloadVideo;
  }
});
