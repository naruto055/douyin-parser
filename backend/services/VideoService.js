const crypto = require('crypto');

const config = require('../config');
const cache = require('../utils/cache');
const bilibiliParser = require('../utils/bilibiliParser');
const douyinParser = require('../utils/douyinParser');
const { createParseTiming, logParseTiming } = require('../utils/parseTiming');

const CDN_CACHE_SAFETY_MARGIN_MS = 60000;

class VideoService {
  /**
   * 解析单个视频地址，并复用统一的解析与缓存流程。
   *
   * @param {string} url 用户提交的视频地址或包含视频地址的分享文本。
   * @returns {Promise<object>} 解析器返回的视频数据。
   */
  static async parseVideo(url, options = {}) {
    // 这里把可变行为交给 getOrParseVideoData，避免解析、缓存等主流程在多个方法中重复。
    return this.getOrParseVideoData(url, {
      cacheHitLogMessage: 'Using cached result for video:',
      ...options
    });
  }

  /**
   * 获取缓存中的解析结果；缓存不存在时解析视频地址并写入缓存。
   *
   * @param {string} url 用户提交的视频地址或分享文本。
   * @param {object} [options={}] 解析流程的可选配置。
   * @param {string} [options.parseInput] 传给解析器的原始输入；未提供时使用解析后的真实地址。
   * @param {string} [options.cacheHitLogMessage] 缓存命中时输出的日志前缀。
   * @param {string} [options.parseLogLabel] 解析日志场景标识；值为 download 时输出下载解析日志。
   * @returns {Promise<object>} 缓存或解析器返回的视频数据。
   */
  static async getOrParseVideoData(url, options = {}) {
    const timing = createParseTiming('video-service');
    // 用平台上下文把“识别、短链展开、解析”三步统一起来，避免服务层写死某个平台。
    const parserContext = this._resolveParserContext(url);
    // 分享文本通常混有标题和链接，先抽取真实 URL 可以让服务层兼容更多输入形态。
    const extractedUrl = parserContext.extractUrlFromText(url) || url;
    // 短链解析由平台工具层统一处理，已包含作品 ID 的链接会在工具内部直接短路返回。
    const shortUrlStartTime = Date.now();
    const realUrl = await parserContext.resolveShortUrl(extractedUrl);
    console.log(`VideoService short URL resolution completed in ${Date.now() - shortUrlStartTime}ms`);
    // videoId 是更稳定的缓存维度；如果解析失败，后面会退回到 URL 哈希作为兜底键。
    const videoId = parserContext.extractVideoId(realUrl);
    const cacheKey = this._generateCacheKey(videoId, realUrl, parserContext.platform);

    let parsedData = options.forceRefresh ? null : cache.get(cacheKey);
    if (parsedData) {
      // 缓存命中时直接返回，避免重复启动解析链路，减少外部页面变化和网络延迟带来的不确定性。
      console.log(options.cacheHitLogMessage || 'Using cached parsed data for video:', videoId || cacheKey);
      logParseTiming(timing.snapshot());
      return parsedData;
    }

    if (options.parseLogLabel === 'download') {
      // 下载场景单独打日志，便于排查“解析成功但下载失败”和“解析阶段失败”的边界。
      console.log('Parsing URL for download:', parserContext.sanitizeUrlForLog(realUrl));
    }

    // parseInput 允许调用方保留原始输入；默认使用 realUrl，确保普通解析路径基于规范化后的地址。
    const parseStartTime = Date.now();
    parsedData = await parserContext.parse(options.parseInput || realUrl, {
      skipShortUrlResolution: !options.parseInput
    });
    console.log(`VideoService parser completed in ${Date.now() - parseStartTime}ms`);
    // 只在解析成功后写缓存，避免把失败或不完整结果固化到后续请求中。
    const cacheTtl = this._resolveCacheTtl(parsedData);
    if (cacheTtl > 0) {
      cache.set(cacheKey, parsedData, cacheTtl);
    }

    // 返回值保持为解析器的原始结果，服务层不额外改形状，避免破坏上层已有契约。
    logParseTiming(timing.snapshot());
    return parsedData;
  }

  /**
   * 根据平台、视频 ID 或 URL 生成缓存键。
   *
   * @param {string|null|undefined} videoId 从真实地址中提取到的视频 ID，存在时优先作为缓存键。
   * @param {string} url 真实视频地址；当 videoId 不可用时用于生成哈希缓存键。
   * @returns {string} 可用于缓存读写的稳定键。
   */
  static _generateCacheKey(videoId, url, platform = 'douyin') {
    // 优先使用业务 ID；没有 ID 时使用 md5 生成短且稳定的键，避免原始 URL 过长影响缓存存取。
    const stableId = videoId || crypto.createHash('md5').update(url).digest('hex');
    // 平台前缀必须带上，否则不同平台的同名 ID 会互相污染缓存。
    return `${platform}:${stableId}`;
  }

  static _resolveParserContext(input) {
    // 先判定是否是 B 站输入，再选择对应的解析器和短链处理逻辑。
    if (bilibiliParser.isBilibiliUrl(input)) {
      return {
        platform: 'bilibili',
        parse: (url) => bilibiliParser.parse(url),
        resolveShortUrl: bilibiliParser.resolveShortUrl,
        extractUrlFromText: bilibiliParser.extractUrlFromText,
        extractVideoId: bilibiliParser.extractBvid,
        sanitizeUrlForLog: douyinParser.sanitizeUrlForLog
      };
    }

    return {
      platform: 'douyin',
      parse: douyinParser.parse,
      resolveShortUrl: douyinParser.resolveShortUrl,
      extractUrlFromText: douyinParser.extractUrlFromText,
      extractVideoId: douyinParser.extractVideoId,
      sanitizeUrlForLog: douyinParser.sanitizeUrlForLog
    };
  }

  /**
   * 根据 CDN URL 过期时间收缩缓存 TTL，避免缓存已失效的签名地址。
   *
   * @param {object} parsedData 解析结果
   * @returns {number} 可缓存 TTL，单位毫秒；0 表示不缓存
   */
  static _resolveCacheTtl(parsedData) {
    const defaultTtl = config.cacheTTL;
    const expiresAt = Number(parsedData?.videoExpiresAt);

    if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
      return defaultTtl;
    }

    const cdnTtl = expiresAt * 1000 - Date.now() - CDN_CACHE_SAFETY_MARGIN_MS;
    if (cdnTtl <= 0) {
      return 0;
    }

    return Math.min(defaultTtl, cdnTtl);
  }
}

module.exports = VideoService;
