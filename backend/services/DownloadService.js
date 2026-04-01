const fs = require('fs');

const audioExtractor = require('../utils/audioExtractor');
const { sanitizeFilename } = require('../utils/stringUtil');
const { streamFromUrl } = require('../utils/streamUtil');
const VideoService = require('./VideoService');

class DownloadService {
  static async downloadVideo(url, title, res) {
    const { parsedData, baseFilename } = await this._prepareDownloadData(url, title);
    const downloadUrl = parsedData.videoUrl;

    if (!downloadUrl) {
      const error = new Error('No video URL available');
      error.statusCode = 400;
      throw error;
    }

    console.log('Streaming video from:', downloadUrl);
    await this.streamMedia(downloadUrl, res, `${baseFilename}.mp4`, 'video/mp4');
  }

  static async downloadAudio(url, title, res, next) {
    const { parsedData, baseFilename } = await this._prepareDownloadData(url, title);

    if (parsedData.audioReady && parsedData.audioUrl) {
      console.log('Streaming audio directly from:', parsedData.audioUrl);
      await this.streamMedia(parsedData.audioUrl, res, `${baseFilename}.mp3`, 'audio/mpeg');
      return;
    }

    if (!parsedData.videoUrl) {
      const error = new Error('No audio or video URL available');
      error.statusCode = 400;
      throw error;
    }

    console.log('Extracting audio from video...');
    const result = await audioExtractor.extractAudioFromUrl(parsedData.videoUrl);

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

  static async streamMedia(mediaUrl, res, filename, contentType) {
    await streamFromUrl(mediaUrl, res, filename, contentType);
  }

  static async _prepareDownloadData(url, title) {
    const parsedData = await VideoService.getOrParseVideoData(url, {
      parseLogLabel: 'download'
    });

    const resolvedTitle = parsedData.title || title || 'douyin_video';
    return {
      parsedData,
      baseFilename: sanitizeFilename(resolvedTitle)
    };
  }
}

module.exports = DownloadService;
