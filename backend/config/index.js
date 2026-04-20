require('dotenv').config();

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
  },

  ai: {
    enabled: process.env.AI_CHAT_ENABLED !== 'false',
    provider: process.env.LLM_PROVIDER || 'openai-compatible',
    apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || 'gpt-4.1-mini',
    maxTokens: Number(process.env.LLM_MAX_TOKENS || 1200),
    temperature: Number(process.env.LLM_TEMPERATURE || 0.2),
    sessionLimit: Number(process.env.AI_SESSION_LIMIT || 10),
    requestTimeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_MS || 30000),
    rateLimit: {
      windowMs: Number(process.env.AI_RATE_LIMIT_WINDOW_MS || 60000),
      max: Number(process.env.AI_RATE_LIMIT_MAX || 10)
    }
  }
};
