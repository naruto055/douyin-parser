const fs = require('fs');

const audioExtractor = require('../utils/audioExtractor');
const AppError = require('../errors/AppError');
const ErrorCodes = require('../errors/errorCodes');
const { extractUrlFromText, sanitizeUrlForLog } = require('../utils/douyinParser');
const { sanitizeFilename } = require('../utils/stringUtil');
const { streamFromUrl } = require('../utils/streamUtil');
const VideoService = require('./VideoService');

class DownloadService {
  static DEFAULT_BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/120.0.0.0 Safari/537.36';

  static async downloadVideo(url, title, res) {
    const { parsedData, baseFilename } = await this._prepareDownloadData(url, title);
    const downloadUrl = this._pickValidUrl(parsedData.videoUrl);

    if (!downloadUrl) {
      throw new AppError({
        code: ErrorCodes.DOWNLOAD_RESOURCE_MISSING,
        message: 'No video URL available'
      });
    }

    const requestContext = this._buildMediaRequestContext(url, parsedData);
    console.log('Streaming video from:', sanitizeUrlForLog(downloadUrl));

    try {
      await this.streamMedia(downloadUrl, res, `${baseFilename}.mp4`, 'video/mp4', requestContext);
    } catch (error) {
      if (!this._shouldRetryWithFreshParse(error)) {
        throw error;
      }

      console.warn('Video stream received 403, refreshing parse result and retrying once');
      const refreshed = await this._prepareDownloadData(url, title, { forceRefresh: true });
      const refreshedUrl = this._pickValidUrl(refreshed.parsedData.videoUrl);
      if (!refreshedUrl) {
        throw new AppError({
          code: ErrorCodes.DOWNLOAD_RESOURCE_MISSING,
          message: 'No video URL available'
        });
      }

      const refreshedRequestContext = this._buildMediaRequestContext(url, refreshed.parsedData);
      await this.streamMedia(
        refreshedUrl,
        res,
        `${refreshed.baseFilename}.mp4`,
        'video/mp4',
        refreshedRequestContext
      );
    }
  }

  static async downloadAudio(url, title, res, next) {
    const { parsedData, baseFilename } = await this._prepareDownloadData(url, title);
    const audioUrl = this._pickValidUrl(parsedData.audioUrl);
    const videoUrl = this._pickValidUrl(parsedData.videoUrl);

    if (parsedData.audioReady && audioUrl) {
      const requestContext = this._buildMediaRequestContext(url, parsedData);
      console.log('Streaming audio directly from:', sanitizeUrlForLog(audioUrl));
      try {
        await this.streamMedia(audioUrl, res, `${baseFilename}.mp3`, 'audio/mpeg', requestContext);
      } catch (error) {
        if (!this._shouldRetryWithFreshParse(error)) {
          if (!videoUrl) {
            this._throwAudioUnavailable(error);
          }
          await this._extractAudioFromVideo(url, parsedData, baseFilename, res, next);
          return;
        }

        console.warn('Audio stream received 403, refreshing parse result and retrying once');
        const refreshed = await this._prepareDownloadData(url, title, { forceRefresh: true });
        const refreshedAudioUrl = this._pickValidUrl(refreshed.parsedData.audioUrl);
        const refreshedVideoUrl = this._pickValidUrl(refreshed.parsedData.videoUrl);
        if (!refreshed.parsedData.audioReady || !refreshedAudioUrl) {
          if (!refreshedVideoUrl) {
            this._throwAudioUnavailable(error);
          }
          await this._extractAudioFromVideo(url, refreshed.parsedData, refreshed.baseFilename, res, next);
          return;
        }

        const refreshedRequestContext = this._buildMediaRequestContext(url, refreshed.parsedData);
        try {
          await this.streamMedia(
            refreshedAudioUrl,
            res,
            `${refreshed.baseFilename}.mp3`,
            'audio/mpeg',
            refreshedRequestContext
          );
        } catch (retryError) {
          if (!refreshedVideoUrl) {
            this._throwAudioUnavailable(retryError);
          }
          await this._extractAudioFromVideo(url, refreshed.parsedData, refreshed.baseFilename, res, next);
        }
      }
      return;
    }

    if (!videoUrl) {
      throw new AppError({
        code: ErrorCodes.DOWNLOAD_RESOURCE_MISSING,
        message: 'No audio or video URL available'
      });
    }

    console.log('Extracting audio from video...');
    await this._extractAudioFromVideo(url, parsedData, baseFilename, res, next);
  }

  static async _extractAudioFromVideo(url, parsedData, baseFilename, res, next) {
    const videoUrl = this._pickValidUrl(parsedData.videoUrl);
    if (!videoUrl) {
      throw new AppError({
        code: ErrorCodes.DOWNLOAD_RESOURCE_MISSING,
        message: 'No audio or video URL available'
      });
    }

    let result;
    try {
      const requestContext = this._buildMediaRequestContext(url, parsedData);
      result = await audioExtractor.extractAudioFromUrl(videoUrl, requestContext);
    } catch (error) {
      this._throwAudioUnavailable(error);
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(baseFilename)}.mp3"`);

    const fileStream = fs.createReadStream(result.path);
    fileStream.pipe(res);

    fileStream.on('end', () => {
      setTimeout(() => {
        if (fs.existsSync(result.path)) {
          fs.unlink(result.path, (error) => {
            if (error) {
              console.error('Error deleting temp file:', error);
            }
          });
        }
      }, 5000);
    });

    fileStream.on('error', (error) => {
      console.error('Error reading file:', error);
      if (fs.existsSync(result.path)) {
        fs.unlinkSync(result.path);
      }
      next(error);
    });
  }

  static async streamMedia(mediaUrl, res, filename, contentType, requestContext = {}) {
    await streamFromUrl(mediaUrl, res, filename, contentType, requestContext);
  }

  static async _prepareDownloadData(url, title, options = {}) {
    const parsedData = await VideoService.getOrParseVideoData(url, {
      parseLogLabel: 'download',
      ...options
    });

    const resolvedTitle = parsedData.title || title || 'douyin_video';
    return {
      parsedData,
      baseFilename: sanitizeFilename(resolvedTitle)
    };
  }

  static _buildMediaRequestContext(sourceUrl, parsedData) {
    const referer = this._resolveSafeReferer(parsedData.referer, sourceUrl);
    const headers = {
      Referer: referer,
      Origin: 'https://www.douyin.com',
      'User-Agent': this._sanitizeHeaderValue(parsedData.userAgent) || this.DEFAULT_BROWSER_UA
    };

    const cookie = this._sanitizeHeaderValue(parsedData.cookie);
    if (cookie) {
      headers.Cookie = cookie;
    }

    return { headers };
  }

  static _resolveSafeReferer(primaryReferer, fallbackSourceUrl) {
    const refererCandidate = primaryReferer || extractUrlFromText(fallbackSourceUrl) || fallbackSourceUrl;
    const sanitizedReferer = this._sanitizeHeaderValue(refererCandidate);

    if (!sanitizedReferer) {
      return 'https://www.douyin.com/';
    }

    try {
      const parsedUrl = new URL(sanitizedReferer);
      if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
        return parsedUrl.toString();
      }
    } catch (error) {
      // 非法 URL 直接回退到默认 Referer，避免把脏值写进请求头。
    }

    return 'https://www.douyin.com/';
  }

  static _sanitizeHeaderValue(value) {
    if (!value || typeof value !== 'string') {
      return '';
    }

    return value.replace(/[\r\n\x00]+/g, '').trim();
  }

  static _shouldRetryWithFreshParse(error) {
    return error?.response?.status === 403;
  }

  static _pickValidUrl(value) {
    if (typeof value !== 'string' || !value.trim()) {
      return '';
    }

    try {
      const parsedUrl = new URL(value.trim());
      if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
        return parsedUrl.toString();
      }
    } catch (error) {
      // 非法媒体 URL 不进入 axios/ffmpeg，避免 [object Object] 类错误继续下传。
    }

    return '';
  }

  static _throwAudioUnavailable(error) {
    const message = error?.code === 'ENOENT'
      ? 'FFmpeg executable not found. Please install ffmpeg or configure FFMPEG_PATH.'
      : error?.message || 'Audio resource unavailable';

    throw new AppError({
      code: ErrorCodes.DOWNLOAD_RESOURCE_MISSING,
      message
    });
  }
}

module.exports = DownloadService;
