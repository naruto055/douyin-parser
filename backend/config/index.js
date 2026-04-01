module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  browserPool: {
    maxConcurrency: 3,
    retryLimit: 2,
    retryDelay: 1000,
    timeout: 30000
  },

  thirdPartyApis: [
    'https://api.xinyew.cn/api/douyinjx',
    'https://apis.jxcxin.cn/api/douyin',
    'https://www.devtool.top/api/douyin/parse'
  ],

  ffmpeg: {
    audioBitrate: '192k',
    audioFrequency: 44100,
    audioChannels: 2,
    timeout: 300000
  },

  tempDir: './temp',
  cacheEnabled: true,
  cacheTTL: 3600000,

  rateLimit: {
    windowMs: 60000,
    max: 20
  }
};
