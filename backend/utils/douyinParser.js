const axios = require('axios');
const browserPool = require('./browserPool');
const thirdPartyAPI = require('./thirdPartyAPI');

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
    const patterns = [
      /\/video\/(\d+)/,
      /\/note\/(\d+)/,
      /video_id=(\d+)/,
      /item_ids?=(\d+)/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      // 命中任一已知 URL 结构后立即返回，保持逻辑简单直接。
      if (match && match[1]) {
        return match[1];
      }
    }
  } catch (e) {
    console.error('Error extracting video ID:', e);
  }

  return null;
}

/**
 * 解析抖音短链接的真实跳转地址。
 *
 * @param {string} url 原始短链接
 * @returns {Promise<string>} 最终跳转后的真实地址
 */
async function resolveShortUrl(url) {
  try {
    const response = await axios.head(url, {
      maxRedirects: 5,
      timeout: 10000
    });
    return response.request.res.responseUrl || url;
  } catch (error) {
    // 某些服务端会拒绝 HEAD 请求，但仍会在响应头中带上跳转地址。
    if (error.response && error.response.headers && error.response.headers.location) {
      return error.response.headers.location;
    }
    console.log('Could not resolve short URL, using original:', url);
    return url;
  }
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

  if (apiData.aweme_detail) {
    const detail = apiData.aweme_detail;
    result.title = detail.desc || '';
    result.author = detail.author?.nickname || '';
    result.cover = detail.video?.cover?.url_list?.[0] || '';
    result.duration = detail.video?.duration || 0;

    if (detail.music && detail.music.play_url && detail.music.play_url.url_list) {
      // 音频地址存在时直接标记可下载，减少下游重复判断。
      result.audioUrl = detail.music.play_url.url_list[0];
      result.audioReady = true;
    } else {
      result.audioReady = false;
    }

    if (detail.video && detail.video.play_addr && detail.video.play_addr.url_list) {
      result.videoUrl = detail.video.play_addr.url_list[0];
    }
  } else if (apiData.title || apiData.cover) {
    result.title = apiData.title || '';
    result.cover = apiData.cover || '';
    result.author = apiData.author || '';
    result.audioReady = false;
  }

  return result;
}

/**
 * 使用浏览器池解析抖音页面。
 *
 * @param {string} url 抖音页面地址
 * @returns {Promise<object>} 解析结果
 */
async function parseWithPuppeteer(url) {
  try {
    console.log('Parsing with Puppeteer...');
    const apiData = await browserPool.execute(url);
    const result = extractVideoInfo(apiData);

    // 至少需要拿到标题或封面之一，才认为结果具备可用价值。
    if (result && (result.title || result.cover)) {
      console.log('Puppeteer parse succeeded');
      return result;
    }
    throw new Error('Puppeteer parse returned no useful data');
  } catch (error) {
    console.error('Puppeteer parse failed:', error.message);
    throw error;
  }
}

/**
 * 解析抖音链接，优先使用 Puppeteer，失败后回退到第三方接口。
 *
 * @param {string} url 用户输入的链接或包含链接的文本
 * @returns {Promise<object>} 归一化后的作品信息
 */
async function parse(url) {
  if (!url) {
    throw new Error('URL is required');
  }

  console.log('Starting parse for URL:', url);

  const extractedUrl = extractUrlFromText(url);
  if (extractedUrl && extractedUrl !== url) {
    // 兼容“文案 + 链接”场景，优先提取出真正的 URL。
    console.log('Extracted URL from text:', extractedUrl);
    url = extractedUrl;
  }

  const realUrl = await resolveShortUrl(url);
  console.log('Real URL:', realUrl);

  let result = null;

  try {
    result = await parseWithPuppeteer(realUrl);
  } catch (error) {
    console.log('Puppeteer failed, trying third-party APIs...');
  }

  if (!result) {
    try {
      // 浏览器解析失败时，再尝试第三方服务作为兜底方案。
      result = await thirdPartyAPI.parseWithThirdParty(realUrl);
    } catch (error) {
      console.error('Third-party APIs also failed');
    }
  }

  if (!result) {
    throw new Error('All parsing methods failed, please check the URL');
  }

  return result;
}

module.exports = {
  parse,
  resolveShortUrl,
  extractVideoInfo,
  extractUrlFromText,
  extractVideoId
};
