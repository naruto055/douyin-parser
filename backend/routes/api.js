const express = require('express');

const DownloadService = require('../services/DownloadService');
const VideoService = require('../services/VideoService');
const { isDirectMediaUrl } = require('../utils/urlValidator');
const router = express.Router();

router.post('/parse', async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });
    const data = await VideoService.parseVideo(url);
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/download', async (req, res, next) => {
  try {
    const { type, url, title } = req.query;
    if (!type || !url) return res.status(400).json({ success: false, error: 'type and url are required' });
    if (isDirectMediaUrl(url)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL type. Please provide a Douyin video page URL, not a direct media file URL.'
      });
    }
    if (type === 'video') {
      await DownloadService.downloadVideo(url, title, res);
      return;
    }
    if (type === 'audio') {
      await DownloadService.downloadAudio(url, title, res, next);
      return;
    }

    return res.status(400).json({
      success: false,
      error: 'Invalid type. Must be "audio" or "video"'
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
