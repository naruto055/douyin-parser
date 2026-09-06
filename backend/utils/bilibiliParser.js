const axios = require('axios');

const { normalizeParseResult } = require('./parseResultNormalizer');
const cache = require('./cache');
const config = require('../config');

const BILIBILI_VIEW_URL = 'https://api.bilibili.com/x/web-interface/view';
const BILIBILI_PAGELIST_URL = 'https://api.bilibili.com/x/player/pagelist';
const BILIBILI_PLAYURL_URL = 'https://api.bilibili.com/x/player/playurl';
const BILIBILI_SHORT_URL_CACHE_PREFIX = 'bilibili-short-url:';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

function extractUrlFromText(text) {
  if (!text) return null;

  // 分享文本里常带标题和多余字符，这里只抓第一个可用链接。
  const matches = String(text).match(/https?:\/\/[^\s]+/g);
  if (!matches || matches.length === 0) {
    return null;
  }

  return matches.find((url) => url.includes('bilibili.com') || url.includes('b23.tv')) || matches[0];
}

function extractBvid(input) {
  if (!input) return null;

  const text = String(input);
  try {
    // 优先从标准 URL 参数里取 BV 号，避免误命中正文里的其他片段。
    const parsedUrl = new URL(extractUrlFromText(text) || text);
    const bvid = parsedUrl.searchParams.get('bvid');
    if (bvid && /^BV[0-9A-Za-z]+$/.test(bvid)) {
      return bvid;
    }
  } catch (error) {
    // 非 URL 文本继续走正则兜底。
  }

  const match = text.match(/BV[0-9A-Za-z]{8,}/);
  return match ? match[0] : null;
}

function isBilibiliUrl(input) {
  if (!input) return false;

  const url = extractUrlFromText(input) || input;
  try {
    const hostname = new URL(url).hostname;
    // 既支持长视频页，也支持 b23 短链。
    return hostname === 'b23.tv' || hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com');
  } catch (error) {
    return Boolean(extractBvid(input));
  }
}

function buildVideoPageUrl(bvid) {
  return `https://www.bilibili.com/video/${bvid}/`;
}

function buildRequestHeaders(referer) {
  return {
    Accept: 'application/json, text/plain, */*',
    Referer: referer,
    'User-Agent': DEFAULT_USER_AGENT
  };
}

function isBilibiliShortUrl(input) {
  try {
    return new URL(input).hostname === 'b23.tv';
  } catch (error) {
    return false;
  }
}

function resolveRedirectLocation(baseUrl, location) {
  if (!location) return '';

  try {
    return new URL(location, baseUrl).toString();
  } catch (error) {
    return '';
  }
}

async function requestShortUrlRedirect(url, method) {
  try {
    const response = await axios.request({
      method,
      url,
      timeout: 10000,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: buildRequestHeaders('https://www.bilibili.com/')
    });

    return resolveRedirectLocation(url, response.headers?.location);
  } catch (error) {
    // HEAD 不稳定时回退 GET，避免短链偶发无法展开。
    return resolveRedirectLocation(url, error.response?.headers?.location);
  }
}

async function resolveShortUrl(input) {
  const url = extractUrlFromText(input) || input;
  if (!isBilibiliShortUrl(url)) {
    return url;
  }

  const cacheKey = `${BILIBILI_SHORT_URL_CACHE_PREFIX}${url}`;
  // 短链展开结果短时间内重复率高，单独缓存可以减少额外跳转请求。
  const cachedUrl = cache.get(cacheKey);
  if (cachedUrl) {
    return cachedUrl;
  }

  const resolvedUrl = await requestShortUrlRedirect(url, 'HEAD') ||
    await requestShortUrlRedirect(url, 'GET') ||
    url;

  if (resolvedUrl !== url) {
    cache.set(cacheKey, resolvedUrl, config.shortUrlCacheTTL);
  }

  return resolvedUrl;
}

async function requestJson(url, referer) {
  const response = await axios.get(url, {
    timeout: 10000,
    responseType: 'json',
    headers: buildRequestHeaders(referer)
  });

  const data = response.data;
  if (!data || data.code !== 0) {
    throw new Error(data?.message || 'Bilibili API request failed');
  }

  return data.data;
}

function getBaseUrl(stream) {
  return stream?.baseUrl || stream?.base_url || '';
}

function getBackupUrls(stream) {
  const backupUrls = stream?.backupUrl || stream?.backup_url || [];
  return Array.isArray(backupUrls) ? backupUrls.filter(Boolean) : [];
}

function inferCodec(stream) {
  const codecs = String(stream?.codecs || '').toLowerCase();
  if (codecs.includes('avc') || codecs.includes('h264')) return 'h264';
  if (codecs.includes('hev') || codecs.includes('hvc') || codecs.includes('h265')) return 'h265';
  if (codecs.includes('av01')) return 'av1';
  return codecs || 'unknown';
}

function selectBestVideoStream(streams = []) {
  const candidates = streams
    .filter((stream) => getBaseUrl(stream))
    .map((stream) => ({
      stream,
      // 优先选 H.264，兼容性比 H.265 / AV1 更稳。
      h264Score: inferCodec(stream) === 'h264' ? 1 : 0,
      quality: Number(stream.id) || 0,
      bandwidth: Number(stream.bandwidth) || 0
    }))
    .sort((a, b) => (
      b.h264Score - a.h264Score ||
      b.quality - a.quality ||
      b.bandwidth - a.bandwidth
    ));

  return candidates[0]?.stream || null;
}

function selectBestAudioStream(streams = []) {
  const candidates = streams
    .filter((stream) => getBaseUrl(stream))
    // 音频只看可用性和码率，优先更高的音质。
    .sort((a, b) => (Number(b.bandwidth) || 0) - (Number(a.bandwidth) || 0));

  return candidates[0] || null;
}

function parseUrlExpiresAt(urls) {
  for (const url of urls) {
    try {
      const parsedUrl = new URL(url);
      const expires = parsedUrl.searchParams.get('deadline') ||
        parsedUrl.searchParams.get('expires') ||
        parsedUrl.searchParams.get('e');
      const timestamp = Number(expires);
      if (Number.isFinite(timestamp) && timestamp > 0) {
        return timestamp;
      }
    } catch (error) {
      // 忽略无法解析的备用地址，继续检查下一个。
    }
  }

  return 0;
}

function normalizeStreamUrls(stream) {
  const baseUrl = getBaseUrl(stream);
  return [baseUrl, ...getBackupUrls(stream)].filter(Boolean);
}

function buildParseResult({ bvid, viewData, cid, page, playData, referer }) {
  const videoStream = selectBestVideoStream(playData?.dash?.video || []);
  const audioStream = selectBestAudioStream(playData?.dash?.audio || []);

  if (!videoStream) {
    throw new Error('Bilibili video stream unavailable');
  }

  const videoUrls = normalizeStreamUrls(videoStream);
  const audioUrls = audioStream ? normalizeStreamUrls(audioStream) : [];
  if (!audioStream || !audioUrls[0]) {
    // B 站视频下载需要视频轨和音频轨同时存在，缺音频直接视为不可用。
    throw new Error('Bilibili audio stream unavailable');
  }

  const owner = viewData.owner || {};
  const expiresAt = parseUrlExpiresAt([...videoUrls, ...audioUrls]);

  return normalizeParseResult({
    platform: 'bilibili',
    source: 'bilibili_playurl',
    shareUrl: referer,
    referer,
    userAgent: DEFAULT_USER_AGENT,
    title: viewData.title || '',
    author: owner.name || '',
    cover: viewData.pic || '',
    duration: (Number(viewData.duration) || page?.duration || 0) * 1000,
    videoUrl: videoUrls[0],
    videoBackupUrls: videoUrls,
    videoCodec: inferCodec(videoStream),
    videoFormat: 'mp4',
    videoWidth: Number(videoStream.width) || 0,
    videoHeight: Number(videoStream.height) || 0,
    videoBitRate: Number(videoStream.bandwidth) || 0,
    videoSource: 'dash.video',
    videoExpiresAt: expiresAt,
    videoMimeType: videoStream.mimeType || videoStream.mime_type || 'video/mp4',
    audioUrl: audioUrls[0],
    audioBackupUrls: audioUrls,
    audioType: 'dash_audio',
    audioTitle: viewData.title || '',
    audioAuthor: owner.name || '',
    audioReady: true,
    audioMimeType: audioStream?.mimeType || audioStream?.mime_type || 'audio/mp4',
    audioFormat: 'm4a',
    requiresMuxing: true,
    bilibili: {
      bvid,
      aid: viewData.aid || 0,
      cid,
      page: page?.page || 1,
      part: page?.part || viewData.title || '',
      quality: playData?.quality || 0
    }
  });
}

async function parse(input) {
  const bvid = extractBvid(input);
  if (!bvid) {
    throw new Error('Bilibili BV ID is required');
  }

  const referer = buildVideoPageUrl(bvid);
  // 先拿作品基础信息，再拿分页和播放流，避免直接依赖单个接口返回全量字段。
  const viewUrl = new URL(BILIBILI_VIEW_URL);
  viewUrl.searchParams.set('bvid', bvid);
  const viewData = await requestJson(viewUrl.toString(), referer);

  const pagelistUrl = new URL(BILIBILI_PAGELIST_URL);
  pagelistUrl.searchParams.set('bvid', bvid);
  pagelistUrl.searchParams.set('jsonp', 'jsonp');
  const pages = await requestJson(pagelistUrl.toString(), referer);
  const page = Array.isArray(pages) && pages.length > 0 ? pages[0] : viewData.pages?.[0];
  const cid = page?.cid || viewData.cid;
  if (!cid) {
    throw new Error('Bilibili cid is required');
  }

  const playUrl = new URL(BILIBILI_PLAYURL_URL);
  playUrl.searchParams.set('bvid', bvid);
  playUrl.searchParams.set('cid', String(cid));
  // fnval=16 用来请求 DASH 流，后续才能分别处理视频轨和音频轨。
  playUrl.searchParams.set('qn', '80');
  playUrl.searchParams.set('fnval', '16');
  playUrl.searchParams.set('fnver', '0');
  playUrl.searchParams.set('fourk', '1');
  const playData = await requestJson(playUrl.toString(), referer);

  return buildParseResult({
    bvid,
    viewData,
    cid,
    page,
    playData,
    referer
  });
}

module.exports = {
  DEFAULT_USER_AGENT,
  parse,
  extractUrlFromText,
  extractBvid,
  isBilibiliUrl,
  isBilibiliShortUrl,
  resolveShortUrl,
  selectBestVideoStream,
  selectBestAudioStream,
  buildVideoPageUrl,
  buildParseResult
};
