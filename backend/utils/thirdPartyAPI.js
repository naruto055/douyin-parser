const axios = require('axios');
const config = require('../config');

/**
 * 调用新叶接口解析抖音链接。
 *
 * @param {string} url 抖音链接
 * @returns {Promise<object>} 统一结构的解析结果
 */
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

/**
 * 调用创新接口解析抖音链接。
 *
 * @param {string} url 抖音链接
 * @returns {Promise<object>} 统一结构的解析结果
 */
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

/**
 * 调用 Devtool 接口解析抖音链接。
 *
 * @param {string} url 抖音链接
 * @returns {Promise<object>} 统一结构的解析结果
 */
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

/**
 * 将不同第三方接口的返回值归一化为统一字段结构。
 *
 * @param {any} data 第三方接口原始响应
 * @param {'xinyew' | 'jxcxin' | 'devtool'} source 数据来源
 * @returns {object} 统一结构的解析结果
 */
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
    // 三方接口字段含义接近，但成功判定与字段命名并不完全一致，因此统一在此收口。
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

  // 统一补充音频可用性标识，减少下游业务判断分支。
  result.audioReady = !!result.audioUrl;
  return result;
}

/**
 * 顺序尝试多个第三方解析接口，直到某个接口成功返回可用结果。
 *
 * @param {string} url 抖音链接
 * @returns {Promise<object>} 统一结构的解析结果
 */
async function parseWithThirdParty(url) {
  const apis = [callXinyeApi, callChuangxinApi, callDevtoolApi];

  for (const api of apis) {
    try {
      console.log(`Trying third-party API: ${api.name}`);
      const result = await api(url);
      console.log(`Third-party API succeeded: ${api.name}`);
      return result;
    } catch (error) {
      // 单个服务失败不立即终止，继续尝试下一个可用提供方。
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
