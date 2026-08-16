const axios = require('axios');
const browserPool = require('./browserPool');
const cache = require('./cache');
const config = require('../config');
const thirdPartyAPI = require('./thirdPartyAPI');
const { normalizeParseResult } = require('./parseResultNormalizer');

const HTTP_DETAIL_BASE_URL = 'https://www.douyin.com/aweme/v1/web/aweme/detail/';
// 短链缓存只保存短时间内的跳转结果，避免重复请求同一个分享短链。
const SHORT_URL_CACHE_PREFIX = 'short-url:';

/**
 * 从任意文本中提取第一个 URL，并优先返回抖音相关链接。
 *
 * @param {string} text 用户输入的原始文本
 * @returns {string | null} 提取到的 URL
 */
function extractUrlFromText(text) {
  if (!text) return null;

  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlPattern);

  if (matches && matches.length > 0) {
    for (const url of matches) {
      // 优先选取抖音域名，避免文本中存在多个链接时误用其他地址。
      if (url.includes('douyin.com') || url.includes('v.douyin.com')) {
        return url;
      }
    }
    // 若没有抖音域名，则退化为返回文本中第一个 URL。
    return matches[0];
  }
  return null;
}

/**
 * 从抖音不同格式的链接中提取视频或作品 ID。
 *
 * @param {string} url 抖音链接
 * @returns {string | null} 提取到的作品 ID
 */
function extractVideoId(url) {
  if (!url) return null;

  try {
    const parsedUrl = new URL(url);
    const queryKeys = ['aweme_id', 'video_id', 'item_id', 'item_ids'];

    for (const key of queryKeys) {
      const value = parsedUrl.searchParams.get(key);
      if (!value) {
        continue;
      }

      const match = value.match(/\d+/);
      if (match) {
        return match[0];
      }
    }

    const pathMatch = parsedUrl.pathname.match(/\/(?:video|note|share\/video)\/(\d+)/);
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1];
    }
  } catch (e) {
    const patterns = [
      /\/(?:video|note|share\/video)\/(\d+)/,
      /[?&](?:aweme_id|video_id|item_id|item_ids)=(\d+)/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
  }

  return null;
}

/**
 * 组装 HTTP detail 快速路径请求地址。
 *
 * @param {string} awemeId 作品 ID
 * @returns {string} 可直接请求的详情接口地址
 */
function buildHttpDetailUrl(awemeId) {
  const detailUrl = new URL(HTTP_DETAIL_BASE_URL);
  detailUrl.searchParams.set('aweme_id', awemeId);
  detailUrl.searchParams.set('aid', '6383');
  detailUrl.searchParams.set('version_code', '170400');
  detailUrl.searchParams.set('device_platform', 'webapp');
  detailUrl.searchParams.set('os', 'windows');
  detailUrl.searchParams.set('browser_language', 'zh-CN');
  detailUrl.searchParams.set('browser_platform', 'Win32');
  detailUrl.searchParams.set('browser_name', 'Chrome');
  detailUrl.searchParams.set('browser_version', '120.0.0.0');
  return detailUrl.toString();
}

async function tryParseWithHttpDetail(url) {
  // 默认关闭，只有显式开启时才允许这个快速路径介入主链路。
  if (!config.httpDetail.enabled) {
    return null;
  }

  const awemeId = extractVideoId(url);
  if (!awemeId) {
    return null;
  }

  try {
    const response = await axios.get(buildHttpDetailUrl(awemeId), {
      timeout: config.httpDetail.timeoutMs,
      responseType: 'json',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: `https://www.douyin.com/video/${awemeId}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
      }
    });

    const data = response?.data;
    if (data && data.status_code === 0 && data.aweme_detail) {
      const result = extractVideoInfo(data);
      if (result && (result.title || result.cover || result.videoUrl)) {
        result.source = 'http_detail';
        return normalizeParseResult(result);
      }
    }
  } catch (error) {
    // HTTP 快速路径只做低风险只读尝试，任何失败都交给 Puppeteer 继续解析。
  }

  return null;
}

/**
 * 判断输入链接是否需要执行跳转解析。
 *
 * @param {string} url 待判断 URL
 * @returns {boolean} 是否需要解析跳转
 */
function shouldResolveShortUrl(url) {
  if (!url || extractVideoId(url)) {
    return false;
  }

  try {
    const hostname = new URL(url).hostname;
    return hostname === 'v.douyin.com' || hostname.endsWith('.douyin.com');
  } catch (error) {
    return false;
  }
}

/**
 * 日志中仅保留 URL 定位信息，避免输出签名 query。
 *
 * @param {string} url 原始 URL
 * @returns {string} 脱敏后的 URL
 */
function sanitizeUrlForLog(url) {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch (error) {
    return '[invalid-url]';
  }
}

/**
 * 将跳转后的分享页规范化为更适合 Puppeteer 访问的抖音 Web 视频页。
 *
 * @param {string} url 解析跳转后的页面地址
 * @returns {string} 规范化后的页面地址
 */
function normalizeDouyinPageUrl(url) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    return url;
  }

  try {
    const hostname = new URL(url).hostname;
    if (hostname === 'www.iesdouyin.com' || hostname === 'iesdouyin.com') {
      return `https://www.douyin.com/video/${videoId}`;
    }
  } catch (error) {
    return url;
  }

  return url;
}

/**
 * 解析抖音短链接的真实跳转地址。
 *
 * @param {string} url 原始短链接
 * @returns {Promise<string>} 最终跳转后的真实地址
 */
async function resolveShortUrl(url) {
  if (!shouldResolveShortUrl(url)) {
    return url;
  }

  const cacheKey = `${SHORT_URL_CACHE_PREFIX}${url}`;
  // 同一个短链在短时间内重复解析时，直接复用跳转结果。
  const cachedUrl = cache.get(cacheKey);
  if (cachedUrl) {
    return cachedUrl;
  }

  try {
    const response = await axios.head(url, {
      maxRedirects: 5,
      timeout: 4000
    });
    const resolvedUrl = response.request.res.responseUrl || url;
    if (resolvedUrl !== url) {
      cache.set(cacheKey, resolvedUrl, config.shortUrlCacheTTL);
    }
    return resolvedUrl;
  } catch (error) {
    // 某些服务端会拒绝 HEAD 请求，但仍会在响应头中带上跳转地址。
    if (error.response && error.response.headers && error.response.headers.location) {
      const resolvedUrl = error.response.headers.location;
      if (resolvedUrl !== url) {
        cache.set(cacheKey, resolvedUrl, config.shortUrlCacheTTL);
      }
      return resolvedUrl;
    }

    try {
      const response = await axios.get(url, {
        maxRedirects: 5,
        timeout: 4000
      });
      const resolvedUrl = response.request.res.responseUrl || url;
      if (resolvedUrl !== url) {
        cache.set(cacheKey, resolvedUrl, config.shortUrlCacheTTL);
      }
      return resolvedUrl;
    } catch (getError) {
      console.log('Could not resolve short URL, using original:', sanitizeUrlForLog(url));
      return url;
    }
  }
}

/**
 * 获取资源地址列表，统一处理空字段。
 *
 * @param {object | null | undefined} playAddr 播放地址对象
 * @returns {string[]} 可用 URL 列表
 */
function normalizeMediaUrl(value) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const candidates = [
    value.url,
    value.uri,
    value.src,
    value.main_url,
    value.play_url,
    value.download_url
  ];

  return candidates.find((item) => typeof item === 'string' && item.trim())?.trim() || '';
}

function getUrlList(playAddr) {
  if (!Array.isArray(playAddr?.url_list)) {
    return [];
  }

  return playAddr.url_list
    .map(normalizeMediaUrl)
    .filter(Boolean);
}

/**
 * 从多个视频来源中选择当前最适合下载的 MP4 地址。
 *
 * @param {object} video 详情接口中的 video 对象
 * @returns {object | null} 标准化后的视频来源
 */
function selectVideoSource(video) {
  if (!video) return null;

  const h264Urls = getUrlList(video.play_addr_h264);
  if (h264Urls.length > 0) {
    return {
      url: h264Urls[0],
      backupUrls: h264Urls,
      codec: 'h264',
      format: 'mp4',
      width: video.play_addr_h264?.width || video.width || 0,
      height: video.play_addr_h264?.height || video.height || 0,
      bitRate: video.play_addr_h264?.bit_rate || 0,
      source: 'play_addr_h264'
    };
  }

  const playUrls = getUrlList(video.play_addr);
  if (playUrls.length > 0) {
    return {
      url: playUrls[0],
      backupUrls: playUrls,
      codec: 'h264',
      format: 'mp4',
      width: video.play_addr?.width || video.width || 0,
      height: video.play_addr?.height || video.height || 0,
      bitRate: video.play_addr?.bit_rate || 0,
      source: 'play_addr'
    };
  }

  const bestBitRate = Array.isArray(video.bit_rate)
    ? video.bit_rate
      .filter((item) => item && item.is_h265 === 0 && getUrlList(item.play_addr).length > 0)
      .sort((a, b) => {
        const aPixels = (a.play_addr?.width || 0) * (a.play_addr?.height || 0);
        const bPixels = (b.play_addr?.width || 0) * (b.play_addr?.height || 0);
        return bPixels - aPixels || (b.bit_rate || 0) - (a.bit_rate || 0);
      })[0]
    : null;

  if (bestBitRate) {
    const urls = getUrlList(bestBitRate.play_addr);
    return {
      url: urls[0],
      backupUrls: urls,
      codec: 'h264',
      format: bestBitRate.format || bestBitRate.play_addr?.data_type || 'mp4',
      width: bestBitRate.play_addr?.width || 0,
      height: bestBitRate.play_addr?.height || 0,
      bitRate: bestBitRate.bit_rate || 0,
      source: 'bit_rate'
    };
  }

  const downloadUrls = getUrlList(video.download_addr);
  if (downloadUrls.length > 0) {
    return {
      url: downloadUrls[0],
      backupUrls: downloadUrls,
      codec: 'unknown',
      format: 'mp4',
      width: video.download_addr?.width || video.width || 0,
      height: video.download_addr?.height || video.height || 0,
      bitRate: video.download_addr?.bit_rate || 0,
      source: 'download_addr',
      watermarkRisk: true
    };
  }

  return null;
}

/**
 * 提取 H.265 候选源；默认不作为 videoUrl，避免兼容性风险。
 *
 * @param {object} video 详情接口中的 video 对象
 * @returns {object | null} H.265 候选来源
 */
function selectH265Candidate(video) {
  const h265Urls = getUrlList(video?.play_addr_265);
  if (h265Urls.length === 0) {
    return null;
  }

  return {
    url: h265Urls[0],
    backupUrls: h265Urls,
    codec: 'h265',
    format: 'mp4',
    width: video.play_addr_265?.width || video.width || 0,
    height: video.play_addr_265?.height || video.height || 0,
    bitRate: video.play_addr_265?.bit_rate || 0,
    source: 'play_addr_265'
  };
}

/**
 * 将上游返回的原始数据归一化为内部统一结构。
 *
 * @param {any} apiData Puppeteer 捕获到的接口数据或页面兜底数据
 * @returns {object | null} 统一后的解析结果
 */
function extractVideoInfo(apiData) {
  if (!apiData) return null;

  let result = {
    // 标记默认来源，便于后续排查解析链路。
    source: 'puppeteer'
  };

  if (apiData.__diagnostics) {
    result.puppeteerDiagnostics = apiData.__diagnostics;
  }

  if (apiData.aweme_detail) {
    const detail = apiData.aweme_detail;
    result.title = detail.desc || '';
    result.author = detail.author?.nickname || '';
    result.cover = detail.video?.cover?.url_list?.[0] || '';
    result.duration = detail.video?.duration || detail.duration || 0;

    const musicUrls = getUrlList(detail.music?.play_url);
    if (musicUrls.length > 0) {
      // 音频地址存在时直接标记可下载，减少下游重复判断。
      result.audioUrl = musicUrls[0];
      result.audioBackupUrls = musicUrls;
      result.audioType = 'music';
      result.audioTitle = detail.music?.title || '';
      result.audioAuthor = detail.music?.author || '';
      result.audioReady = true;
    } else {
      result.audioReady = false;
    }

    const videoSource = selectVideoSource(detail.video);
    if (videoSource) {
      result.videoUrl = videoSource.url;
      result.videoBackupUrls = videoSource.backupUrls;
      result.videoCodec = videoSource.codec;
      result.videoFormat = videoSource.format;
      result.videoWidth = videoSource.width;
      result.videoHeight = videoSource.height;
      result.videoBitRate = videoSource.bitRate;
      result.videoSource = videoSource.source;
      result.videoExpiresAt = detail.video?.cdn_url_expired || 0;
      if (videoSource.watermarkRisk) {
        result.videoWatermarkRisk = true;
      }
    }

    const h265Candidate = selectH265Candidate(detail.video);
    if (h265Candidate) {
      result.video265Url = h265Candidate.url;
      result.video265BackupUrls = h265Candidate.backupUrls;
      result.video265Codec = h265Candidate.codec;
      result.video265Format = h265Candidate.format;
      result.video265Width = h265Candidate.width;
      result.video265Height = h265Candidate.height;
      result.video265BitRate = h265Candidate.bitRate;
      result.video265Source = h265Candidate.source;
    }
  } else if (apiData.title || apiData.cover) {
    result.title = apiData.title || '';
    result.cover = apiData.cover || '';
    result.author = apiData.author || '';
    result.audioReady = false;
  }

  return normalizeParseResult(result);
}

/**
 * 使用浏览器池解析抖音页面。
 *
 * @param {string} url 抖音页面地址
 * @returns {Promise<object>} 解析结果
 */
async function parseWithPuppeteer(url) {
  const startTime = Date.now();
  try {
    console.log('Parsing with Puppeteer...');
    const apiData = await browserPool.execute(url);
    const result = extractVideoInfo(apiData);

    // 至少需要拿到标题或封面之一，才认为结果具备可用价值。
    if (result && (result.title || result.cover)) {
      console.log(`Puppeteer parse succeeded in ${Date.now() - startTime}ms`);
      return normalizeParseResult(result);
    }

    const error = new Error('Puppeteer parse returned no useful data');
    error.puppeteerDiagnostics = result?.puppeteerDiagnostics || apiData?.__diagnostics || null;
    throw error;
  } catch (error) {
    console.error(`Puppeteer parse failed in ${Date.now() - startTime}ms:`, error.message);
    throw error;
  }
}

/**
 * 解析抖音链接，优先使用 Puppeteer，失败后回退到第三方接口。
 *
 * @param {string} url 用户输入的链接或包含链接的文本
 * @returns {Promise<object>} 归一化后的作品信息
 */
async function parse(url, options = {}) {
  if (!url) {
    throw new Error('URL is required');
  }

  const totalStartTime = Date.now();
  console.log('Starting parse for URL:', sanitizeUrlForLog(url));

  const extractedUrl = extractUrlFromText(url);
  if (extractedUrl && extractedUrl !== url) {
    // 兼容“文案 + 链接”场景，优先提取出真正的 URL。
    console.log('Extracted URL from text:', sanitizeUrlForLog(extractedUrl));
    url = extractedUrl;
  }

  const shortUrlStartTime = Date.now();
  const realUrl = options.skipShortUrlResolution ? url : await resolveShortUrl(url);
  const pageUrl = normalizeDouyinPageUrl(realUrl);
  const shortUrlLogLabel = options.skipShortUrlResolution ? 'Short URL resolution skipped' : 'Short URL resolution completed';
  console.log(`${shortUrlLogLabel} in ${Date.now() - shortUrlStartTime}ms`);
  console.log('Real URL:', sanitizeUrlForLog(realUrl));
  if (pageUrl !== realUrl) {
    console.log('Normalized page URL:', sanitizeUrlForLog(pageUrl));
  }

  const httpDetailResult = await tryParseWithHttpDetail(pageUrl);
  if (httpDetailResult) {
    console.log(`HTTP detail parse succeeded in ${Date.now() - totalStartTime}ms`);
    console.log(`Parse completed in ${Date.now() - totalStartTime}ms`);
    return httpDetailResult;
  }

  try {
    const result = await parseWithPuppeteer(pageUrl);
    console.log(`Parse completed in ${Date.now() - totalStartTime}ms`);
    return result;
  } catch (error) {
    const puppeteerDiagnostics = error.puppeteerDiagnostics || null;
    const puppeteerErrorMessage = error.message || 'Puppeteer parse failed';
    console.log('Puppeteer failed, trying third-party APIs...');

    const thirdPartyStartTime = Date.now();
    try {
      const fallbackResult = await thirdPartyAPI.parseWithThirdParty(pageUrl);
      if (puppeteerDiagnostics) {
        fallbackResult.puppeteerDiagnostics = puppeteerDiagnostics;
      }
      fallbackResult.fallbackReason = puppeteerErrorMessage;
      console.log(`Third-party parse completed in ${Date.now() - thirdPartyStartTime}ms`);
      console.log(`Parse completed in ${Date.now() - totalStartTime}ms`);
      return normalizeParseResult(fallbackResult);
    } catch (thirdPartyError) {
      const parseError = new Error(thirdPartyError.message || puppeteerErrorMessage);
      parseError.puppeteerDiagnostics = puppeteerDiagnostics;
      parseError.data = {
        puppeteerDiagnostics,
        fallbackReason: puppeteerErrorMessage,
        thirdPartyError: thirdPartyError.message || 'Third-party parse failed'
      };
      console.error(`Third-party APIs also failed in ${Date.now() - thirdPartyStartTime}ms`);
      throw parseError;
    }
  }
}

module.exports = {
  parse,
  resolveShortUrl,
  extractVideoInfo,
  selectVideoSource,
  selectH265Candidate,
  normalizeDouyinPageUrl,
  shouldResolveShortUrl,
  sanitizeUrlForLog,
  extractUrlFromText,
  extractVideoId
};
