const fs = require('fs');
const path = require('path');

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const audioExtractor = require('../utils/audioExtractor');
const config = require('../config');
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

  static activeBilibiliMuxCount = 0;

  static bilibiliMuxQueue = [];

  static async downloadVideo(url, title, res) {
    const { parsedData, baseFilename } = await this._prepareDownloadData(url, title);
    if (parsedData?.platform === 'bilibili') {
      // B 站视频下载必须拿到音视频两条轨，不能退化成无声直链。
      this._assertBilibiliMuxable(parsedData);
      try {
        await this._downloadMuxedVideo(url, parsedData, baseFilename, res);
      } catch (error) {
        if (!this._shouldRetryWithFreshParse(error)) {
          throw error;
        }

        console.warn('Bilibili video stream received 403, refreshing parse result and retrying once');
        const refreshed = await this._prepareDownloadData(url, title, { forceRefresh: true });
        this._assertBilibiliMuxable(refreshed.parsedData);
        await this._downloadMuxedVideo(url, refreshed.parsedData, refreshed.baseFilename, res);
      }
      return;
    }

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
        const audioMeta = this._resolveAudioDownloadMeta(parsedData);
        await this.streamMedia(audioUrl, res, `${baseFilename}.${audioMeta.extension}`, audioMeta.contentType, requestContext);
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
          const refreshedAudioMeta = this._resolveAudioDownloadMeta(refreshed.parsedData);
          await this.streamMedia(
            refreshedAudioUrl,
            res,
            `${refreshed.baseFilename}.${refreshedAudioMeta.extension}`,
            refreshedAudioMeta.contentType,
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

  static async _downloadMuxedVideo(sourceUrl, parsedData, baseFilename, res) {
    const videoUrl = this._pickValidUrl(parsedData.videoUrl);
    const audioUrl = this._pickValidUrl(parsedData.audioUrl);
    if (!videoUrl || !audioUrl) {
      throw new AppError({
        code: ErrorCodes.DOWNLOAD_RESOURCE_MISSING,
        message: 'No video or audio URL available for muxing'
      });
    }

    const requestContext = this._buildMediaRequestContext(sourceUrl, parsedData);
    const abortState = this._createDownloadAbortState(res);
    let videoTempPath = '';
    let audioTempPath = '';
    let outputPath = '';

    try {
      // 视频和音频流互不依赖，使用同一个取消信号并行下载，降低总等待时间。
      console.log('Downloading Bilibili video stream from:', sanitizeUrlForLog(videoUrl));
      console.log('Downloading Bilibili audio stream from:', sanitizeUrlForLog(audioUrl));
      const videoDownload = this._downloadTempMedia(videoUrl, requestContext, 'm4v', abortState.signal)
        .then((tempPath) => {
          videoTempPath = tempPath;
          return tempPath;
        })
        .catch((error) => {
          abortState.abort();
          throw error;
        });
      const audioDownload = this._downloadTempMedia(audioUrl, requestContext, 'm4a', abortState.signal)
        .then((tempPath) => {
          audioTempPath = tempPath;
          return tempPath;
        })
        .catch((error) => {
          abortState.abort();
          throw error;
        });

      // 等待两条下载都结束，确保失败时已完成的临时文件也能被 finally 清理。
      const downloadResults = await Promise.allSettled([videoDownload, audioDownload]);
      const failedDownload = downloadResults.find((result) => result.status === 'rejected');
      if (failedDownload) {
        throw failedDownload.reason;
      }

      outputPath = this._buildTempFilePath('mp4');
      await this._withBilibiliMuxSlot(() => audioExtractor.mergeVideoAndAudio(videoTempPath, audioTempPath, outputPath, {
        signal: abortState.signal
      }));
    } catch (error) {
      this._removeFileIfExists(outputPath);
      if (this._shouldRetryWithFreshParse(error)) {
        throw error;
      }
      this._throwDownloadUnavailable(error);
    } finally {
      this._removeFileIfExists(videoTempPath);
      this._removeFileIfExists(audioTempPath);
      abortState.dispose();
    }

    this._streamLocalFile(outputPath, res, `${baseFilename}.mp4`, 'video/mp4');
  }

  static _throwDownloadUnavailable(error) {
    const message = error?.code === 'ENOENT'
      ? 'FFmpeg executable not found. Please install ffmpeg or configure FFMPEG_PATH.'
      : error?.message || 'Download resource unavailable';

    throw new AppError({
      code: ErrorCodes.DOWNLOAD_RESOURCE_MISSING,
      message
    });
  }

  static async _downloadTempMedia(mediaUrl, requestContext, extension, signal) {
    const tempPath = this._buildTempFilePath(extension);
    const writer = fs.createWriteStream(tempPath);
    const maxBytes = this._resolveBilibiliMaxMediaBytes();
    let downloadedBytes = 0;

    try {
      // 先看 Content-Length，再按流计数兜底，防止长视频把磁盘打满。
      const response = await axios.request({
        method: 'GET',
        url: mediaUrl,
        responseType: 'stream',
        timeout: 60000,
        signal,
        headers: {
          Accept: '*/*',
          ...requestContext.headers
        }
      });

      const contentLength = Number(response.headers?.['content-length']);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        response.data.destroy();
        throw new AppError({
          code: ErrorCodes.DOWNLOAD_RESOURCE_MISSING,
          message: 'Bilibili media stream exceeds download size limit'
        });
      }

      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (downloadedBytes > maxBytes) {
            const error = new AppError({
              code: ErrorCodes.DOWNLOAD_RESOURCE_MISSING,
              message: 'Bilibili media stream exceeds download size limit'
            });
            response.data.destroy(error);
            writer.destroy(error);
          }
        });
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
      });

      return tempPath;
    } catch (error) {
      writer.destroy();
      this._removeFileIfExists(tempPath);
      throw error;
    }
  }

  static async _withBilibiliMuxSlot(task) {
    const maxConcurrency = this._resolveBilibiliMaxMuxConcurrency();

    if (this.activeBilibiliMuxCount >= maxConcurrency) {
      await new Promise((resolve) => this.bilibiliMuxQueue.push(resolve));
    }

    // FFmpeg 合并会吃 CPU 和 IO，默认只放一个并发。
    this.activeBilibiliMuxCount += 1;
    try {
      return await task();
    } finally {
      this.activeBilibiliMuxCount -= 1;
      const next = this.bilibiliMuxQueue.shift();
      if (next) {
        next();
      }
    }
  }

  static _resolveBilibiliMaxMediaBytes() {
    const value = Number(config.bilibiliDownload?.maxMediaBytes);
    return Number.isFinite(value) && value > 0 ? value : 524288000;
  }

  static _resolveBilibiliMaxMuxConcurrency() {
    const value = Number(config.bilibiliDownload?.maxMuxConcurrency);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
  }

  static _createDownloadAbortState(res) {
    const controller = new AbortController();
    const abort = () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };
    const onClose = () => {
      if (!res.writableEnded && !res.finished) {
        // 客户端断开时尽早中止下载和合并，避免留下半成品临时文件。
        abort();
      }
    };

    if (typeof res.once === 'function') {
      res.once('close', onClose);
    }

    return {
      signal: controller.signal,
      abort,
      dispose: () => {
        if (typeof res.off === 'function') {
          res.off('close', onClose);
        } else if (typeof res.removeListener === 'function') {
          res.removeListener('close', onClose);
        }
      }
    };
  }

  static _buildTempFilePath(extension) {
    const tempDir = audioExtractor.ensureTempDir();
    return path.join(tempDir, `${uuidv4()}.${extension}`);
  }

  static _streamLocalFile(filePath, res, filename, contentType) {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

    const stats = fs.statSync(filePath);
    res.setHeader('Content-Length', stats.size);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    fileStream.on('close', () => this._removeFileIfExists(filePath));
    fileStream.on('error', (error) => {
      console.error('Error reading muxed file:', error);
      this._removeFileIfExists(filePath);
    });
  }

  static async _prepareDownloadData(url, title, options = {}) {
    const parsedData = await VideoService.getOrParseVideoData(url, {
      parseLogLabel: 'download',
      ...options
    });

    const resolvedTitle = parsedData.title || title || 'parsed_video';
    return {
      parsedData,
      baseFilename: sanitizeFilename(resolvedTitle)
    };
  }

  static _buildMediaRequestContext(sourceUrl, parsedData) {
    const referer = this._resolveSafeReferer(parsedData.referer, sourceUrl);
    const origin = this._resolveOrigin(referer, parsedData.platform);
    const headers = {
      Referer: referer,
      Origin: origin,
      'User-Agent': this._sanitizeHeaderValue(parsedData.userAgent) || this.DEFAULT_BROWSER_UA
    };

    const cookie = this._sanitizeHeaderValue(parsedData.cookie);
    if (cookie) {
      headers.Cookie = cookie;
    }

    return { headers };
  }

  static _resolveOrigin(referer, platform) {
    if (platform === 'bilibili') {
      // B 站媒体请求要用 B 站 Origin，和抖音默认值分开。
      return 'https://www.bilibili.com';
    }

    try {
      const parsedUrl = new URL(referer);
      if (parsedUrl.hostname.endsWith('bilibili.com')) {
        return 'https://www.bilibili.com';
      }
    } catch (error) {
      // 保持抖音默认 Origin。
    }

    return 'https://www.douyin.com';
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

  static _requiresMuxing(parsedData) {
    return parsedData?.platform === 'bilibili' && parsedData.requiresMuxing === true;
  }

  static _assertBilibiliMuxable(parsedData) {
    if (!this._requiresMuxing(parsedData) || !this._pickValidUrl(parsedData.videoUrl) || !this._pickValidUrl(parsedData.audioUrl)) {
      throw new AppError({
        code: ErrorCodes.DOWNLOAD_RESOURCE_MISSING,
        message: 'Bilibili video download requires both video and audio streams'
      });
    }
  }

  static _resolveAudioDownloadMeta(parsedData) {
    if (parsedData?.platform === 'bilibili') {
      // B 站音频不是固定 mp3，保留源流格式，避免误导下载结果。
      return {
        extension: parsedData.audioFormat || 'm4a',
        contentType: parsedData.audioMimeType || 'audio/mp4'
      };
    }

    return {
      extension: 'mp3',
      contentType: 'audio/mpeg'
    };
  }

  static _removeFileIfExists(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
      return;
    }

    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error('Error deleting temp file:', error);
    }
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
