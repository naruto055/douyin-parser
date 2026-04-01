const axios = require('axios');
const config = require('../config');

async function callXinyeApi(url) {
  try {
    const response = await axios.get('https://api.xinyew.cn/api/douyinjx', {
      params: { url },
      timeout: 10000
    });
    return normalizeResponse(response.data, 'xinyew');
  } catch (error) {
    console.error('Xinye API failed:', error.message);
    throw error;
  }
}

async function callChuangxinApi(url) {
  try {
    const response = await axios.get('https://apis.jxcxin.cn/api/douyin', {
      params: { url },
      timeout: 10000
    });
    return normalizeResponse(response.data, 'jxcxin');
  } catch (error) {
    console.error('Chuangxin API failed:', error.message);
    throw error;
  }
}

async function callDevtoolApi(url) {
  try {
    const response = await axios.get('https://www.devtool.top/api/douyin/parse', {
      params: { url },
      timeout: 10000
    });
    return normalizeResponse(response.data, 'devtool');
  } catch (error) {
    console.error('Devtool API failed:', error.message);
    throw error;
  }
}

function normalizeResponse(data, source) {
  let result = { source };

  if (source === 'xinyew') {
    if (data.code === 200 || data.success) {
      const d = data.data || data;
      result = {
        ...result,
        title: d.title || '',
        author: d.author || d.nickname || '',
        cover: d.cover || d.cover_url || '',
        duration: d.duration || 0,
        audioUrl: d.music || d.audio || '',
        videoUrl: d.url || d.video_url || d.video || ''
      };
    } else {
      throw new Error(data.msg || data.message || 'Xinye API error');
    }
  } else if (source === 'jxcxin') {
    if (data.code === 200 || data.success) {
      const d = data.data || data;
      result = {
        ...result,
        title: d.title || '',
        author: d.author || d.nickname || '',
        cover: d.cover || d.cover_url || '',
        duration: d.duration || 0,
        audioUrl: d.music || d.audio || '',
        videoUrl: d.url || d.video_url || d.video || ''
      };
    } else {
      throw new Error(data.msg || data.message || 'Chuangxin API error');
    }
  } else if (source === 'devtool') {
    if (data.code === 200 || data.success) {
      const d = data.data || data;
      result = {
        ...result,
        title: d.title || '',
        author: d.author || d.nickname || '',
        cover: d.cover || d.cover_url || '',
        duration: d.duration || 0,
        audioUrl: d.music || d.audio || '',
        videoUrl: d.url || d.video_url || d.video || ''
      };
    } else {
      throw new Error(data.msg || data.message || 'Devtool API error');
    }
  }

  result.audioReady = !!result.audioUrl;
  return result;
}

async function parseWithThirdParty(url) {
  const apis = [callXinyeApi, callChuangxinApi, callDevtoolApi];

  for (const api of apis) {
    try {
      console.log(`Trying third-party API: ${api.name}`);
      const result = await api(url);
      console.log(`Third-party API succeeded: ${api.name}`);
      return result;
    } catch (error) {
      console.log(`${api.name} failed, trying next...`);
      continue;
    }
  }

  throw new Error('All third-party APIs failed');
}

module.exports = {
  parseWithThirdParty,
  callXinyeApi,
  callChuangxinApi,
  callDevtoolApi
};
