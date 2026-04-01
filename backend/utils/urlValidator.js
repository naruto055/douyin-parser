const MEDIA_EXTENSIONS = /\.(mp3|mp4|webm|wav|m4a|flv|avi|mov|wmv|mkv)$/i;
const MEDIA_DOMAINS = [
  'douyinstatic.com',
  'douyinvod.com',
  'pstatp.com',
  'snssdk.com',
  'ixigua.com'
];

function isDirectMediaUrl(url) {
  if (!url) {
    return false;
  }

  if (MEDIA_EXTENSIONS.test(url)) {
    return true;
  }

  try {
    const hostname = new URL(url).hostname;
    return MEDIA_DOMAINS.some((domain) => hostname.includes(domain));
  } catch {
    return false;
  }
}

module.exports = {
  isDirectMediaUrl
};
