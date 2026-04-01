const crypto = require('crypto');

const cache = require('../utils/cache');
const douyinParser = require('../utils/douyinParser');

class VideoService {
  static async parseVideo(url) {
    return this.getOrParseVideoData(url, {
      parseInput: url,
      cacheHitLogMessage: 'Using cached result for video:'
    });
  }

  static async getOrParseVideoData(url, options = {}) {
    const extractedUrl = douyinParser.extractUrlFromText(url) || url;
    const realUrl = await douyinParser.resolveShortUrl(extractedUrl);
    const videoId = douyinParser.extractVideoId(realUrl);
    const cacheKey = this._generateCacheKey(videoId, realUrl);

    let parsedData = cache.get(cacheKey);
    if (parsedData) {
      console.log(options.cacheHitLogMessage || 'Using cached parsed data for video:', videoId || cacheKey);
      return parsedData;
    }

    if (options.parseLogLabel === 'download') {
      console.log('Parsing URL for download:', realUrl);
    }

    parsedData = await douyinParser.parse(options.parseInput || realUrl);
    cache.set(cacheKey, parsedData);

    return parsedData;
  }

  static _generateCacheKey(videoId, url) {
    return videoId || crypto.createHash('md5').update(url).digest('hex');
  }
}

module.exports = VideoService;
