const MEDIA_EXTENSIONS = /\.(mp3|mp4|webm|wav|m4a|flv|avi|mov|wmv|mkv)$/i;
const MEDIA_DOMAINS = [
  'douyinstatic.com',
  'douyinvod.com',
  'pstatp.com',
  'snssdk.com',
  'ixigua.com'
];

/**
 * 判断给定地址是否为可直接访问的媒体资源链接。
 *
 * @param {string} url 待校验的 URL
 * @returns {boolean} 是否为直链媒体资源
 */
function isDirectMediaUrl(url) {
  if (!url) {
    return false;
  }

  if (MEDIA_EXTENSIONS.test(url)) {
    // 直接通过文件扩展名命中时，可快速判定为媒体资源。
    return true;
  }

  try {
    const hostname = new URL(url).hostname;
    // 某些资源链接不带标准扩展名，因此补充域名白名单判断。
    return MEDIA_DOMAINS.some((domain) => hostname.includes(domain));
  } catch {
    // URL 解析失败时，视为非法或非直链地址。
    return false;
  }
}

module.exports = {
  isDirectMediaUrl
};
