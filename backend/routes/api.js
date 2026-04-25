const express = require('express');

const DownloadService = require('../services/DownloadService');
const VideoService = require('../services/VideoService');
const AppError = require('../errors/AppError');
const ErrorCodes = require('../errors/errorCodes');
const response = require('../utils/response');
const { isDirectMediaUrl } = require('../utils/urlValidator');
const router = express.Router();

router.post('/parse', async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) return response.fail(res, ErrorCodes.VALIDATION_ERROR, 'URL is required', null, 400);
    const data = await VideoService.parseVideo(url);
    return response.ok(res, data);
  } catch (error) {
    return next(new AppError({
      code: ErrorCodes.PARSE_FAILED,
      message: error.message || '视频解析失败'
    }));
  }
});

router.get('/download', async (req, res, next) => {
  try {
    const { type, url, title } = req.query;
    if (!type || !url) return response.fail(res, ErrorCodes.VALIDATION_ERROR, 'type and url are required', null, 400);
    if (isDirectMediaUrl(url)) {
      return response.fail(
        res,
        ErrorCodes.VALIDATION_ERROR,
        'Invalid URL type. Please provide a Douyin video page URL, not a direct media file URL.',
        null,
        400
      );
    }
    if (type === 'video') {
      await DownloadService.downloadVideo(url, title, res);
      return;
    }
    if (type === 'audio') {
      await DownloadService.downloadAudio(url, title, res, next);
      return;
    }

    return response.fail(res, ErrorCodes.VALIDATION_ERROR, 'Invalid type. Must be "audio" or "video"', null, 400);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
