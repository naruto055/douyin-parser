const axios = require('axios');
const browserPool = require('./browserPool');
const thirdPartyAPI = require('./thirdPartyAPI');

function extractUrlFromText(text) {
  if (!text) return null;

  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlPattern);

  if (matches && matches.length > 0) {
    for (const url of matches) {
      if (url.includes('douyin.com') || url.includes('v.douyin.com')) {
        return url;
      }
    }
    return matches[0];
  }
  return null;
}

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
      if (match && match[1]) {
        return match[1];
      }
    }
  } catch (e) {
    console.error('Error extracting video ID:', e);
  }

  return null;
}

async function resolveShortUrl(url) {
  try {
    const response = await axios.head(url, {
      maxRedirects: 5,
      timeout: 10000
    });
    return response.request.res.responseUrl || url;
  } catch (error) {
    if (error.response && error.response.headers && error.response.headers.location) {
      return error.response.headers.location;
    }
    console.log('Could not resolve short URL, using original:', url);
    return url;
  }
}

function extractVideoInfo(apiData) {
  if (!apiData) return null;

  let result = {
    source: 'puppeteer'
  };

  if (apiData.aweme_detail) {
    const detail = apiData.aweme_detail;
    result.title = detail.desc || '';
    result.author = detail.author?.nickname || '';
    result.cover = detail.video?.cover?.url_list?.[0] || '';
    result.duration = detail.video?.duration || 0;

    if (detail.music && detail.music.play_url && detail.music.play_url.url_list) {
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

async function parseWithPuppeteer(url) {
  try {
    console.log('Parsing with Puppeteer...');
    const apiData = await browserPool.execute(url);
    const result = extractVideoInfo(apiData);

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

async function parse(url) {
  if (!url) {
    throw new Error('URL is required');
  }

  console.log('Starting parse for URL:', url);

  const extractedUrl = extractUrlFromText(url);
  if (extractedUrl && extractedUrl !== url) {
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
