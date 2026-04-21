const axios = require('axios');

/**
 * 将远程媒体流透传给客户端，实现服务端下载代理。
 *
 * @param {string} url 远程资源地址
 * @param {import('http').ServerResponse} res HTTP 响应对象
 * @param {string} filename 下载文件名
 * @param {string} contentType 响应 Content-Type
 * @returns {Promise<void>}
 */
async function streamFromUrl(url, res, filename, contentType) {
  try {
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 60000
    });

    res.setHeader('Content-Type', contentType);
    // 对文件名进行 URL 编码，兼容中文或特殊字符下载场景。
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

    if (response.headers['content-length']) {
      // 透传内容长度，便于浏览器展示下载进度。
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    // 直接将上游流式响应写给客户端，避免将整个文件加载进内存。
    response.data.pipe(res);
  } catch (error) {
    console.error('Error streaming from URL:', error);
    throw error;
  }
}

module.exports = {
  streamFromUrl
};
