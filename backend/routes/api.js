const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const douyinParser = require('../utils/douyinParser');
const cache = require('../utils/cache');
const audioExtractor = require('../utils/audioExtractor');
const crypto = require('crypto');

function sanitizeFilename(filename) {
  return filename.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
}

async function streamFromUrl(url, res, filename, contentType) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 60000
    });

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    response.data.pipe(res);
  } catch (error) {
    console.error('Error streaming from URL:', error);
    throw error;
  }
}

router.post('/parse', async (req, res, next) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    const extractedUrl = douyinParser.extractUrlFromText(url) || url;
    const realUrl = await douyinParser.resolveShortUrl(extractedUrl);
    const videoId = douyinParser.extractVideoId(realUrl);

    const cacheKey = videoId || crypto.createHash('md5').update(realUrl).digest('hex');
    let result = cache.get(cacheKey);

    if (!result) {
      result = await douyinParser.parse(url);
      cache.set(cacheKey, result);
    } else {
      console.log('Using cached result for video:', videoId || cacheKey);
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

async function getOrParseVideoData(url) {
  const extractedUrl = douyinParser.extractUrlFromText(url) || url;
  const realUrl = await douyinParser.resolveShortUrl(extractedUrl);
  const videoId = douyinParser.extractVideoId(realUrl);

  const cacheKey = videoId || crypto.createHash('md5').update(realUrl).digest('hex');
  let parsedData = cache.get(cacheKey);

  if (!parsedData) {
    console.log('Parsing URL for download:', realUrl);
    parsedData = await douyinParser.parse(realUrl);
    cache.set(cacheKey, parsedData);
  } else {
    console.log('Using cached parsed data for video:', videoId || cacheKey);
  }

  return parsedData;
}

async function streamAudio(parsedData, baseFilename, res, next) {
  if (parsedData.audioReady && parsedData.audioUrl) {
    console.log('Streaming audio directly from:', parsedData.audioUrl);
    await streamFromUrl(parsedData.audioUrl, res, `${baseFilename}.mp3`, 'audio/mpeg');
  } else if (parsedData.videoUrl) {
    console.log('Extracting audio from video...');
    const result = await audioExtractor.extractAudioFromUrl(parsedData.videoUrl);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(baseFilename)}.mp3"`);

    const fileStream = fs.createReadStream(result.path);
    fileStream.pipe(res);

    fileStream.on('end', () => {
      setTimeout(() => {
        if (fs.existsSync(result.path)) {
          fs.unlink(result.path, (err) => {
            if (err) console.error('Error deleting temp file:', err);
          });
        }
      }, 5000);
    });

    fileStream.on('error', (err) => {
      console.error('Error reading file:', err);
      if (fs.existsSync(result.path)) {
        fs.unlinkSync(result.path);
      }
      next(err);
    });
  } else {
    throw new Error('No audio or video URL available');
  }
}

function isDirectMediaUrl(url) {
  if (!url) return false;

  // 检查文件扩展名
  const mediaExtensions = /\.(mp3|mp4|webm|wav|m4a|flv|avi|mov|wmv|mkv)$/i;
  if (mediaExtensions.test(url)) return true;

  // 检查已知的媒体 CDN 域名
  const mediaDomains = [
    'douyinstatic.com',
    'douyinvod.com',
    'pstatp.com',
    'snssdk.com',
    'ixigua.com'
  ];
  try {
    const hostname = new URL(url).hostname;
    return mediaDomains.some(domain => hostname.includes(domain));
  } catch {
    return false;
  }
}

router.get('/download', async (req, res, next) => {
  try {
    const { type, url, title } = req.query;

    if (!type || !url) {
      return res.status(400).json({
        success: false,
        error: 'type and url are required'
      });
    }

    // 拦截直接媒体 URL，只接受抖音页面 URL
    if (isDirectMediaUrl(url)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL type. Please provide a Douyin video page URL, not a direct media file URL.'
      });
    }

    let parsedData = null;
    let baseFilename = sanitizeFilename(title || 'douyin_video');

    parsedData = await getOrParseVideoData(url);
    if (parsedData.title) {
      baseFilename = sanitizeFilename(parsedData.title);
    }

    if (type === 'video') {
      const downloadUrl = parsedData.videoUrl;
      if (!downloadUrl) {
        return res.status(400).json({
          success: false,
          error: 'No video URL available'
        });
      }
      console.log('Streaming video from:', downloadUrl);
      await streamFromUrl(downloadUrl, res, `${baseFilename}.mp4`, 'video/mp4');
    } else if (type === 'audio') {
      await streamAudio(parsedData, baseFilename, res, next);
    } else {
      res.status(400).json({
        success: false,
        error: 'Invalid type. Must be "audio" or "video"'
      });
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
