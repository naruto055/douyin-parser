const test = require('node:test');
const assert = require('node:assert/strict');

const VideoService = require('../services/VideoService');
const cache = require('../utils/cache');
const douyinParser = require('../utils/douyinParser');

test('VideoService.parseVideo 在缓存命中时直接返回缓存数据', async () => {
  const originalGet = cache.get;
  const originalResolveShortUrl = douyinParser.resolveShortUrl;
  const originalExtractVideoId = douyinParser.extractVideoId;
  const originalParse = douyinParser.parse;

  cache.get = () => ({ title: 'cached-video' });
  douyinParser.resolveShortUrl = async () => 'https://www.douyin.com/video/123';
  douyinParser.extractVideoId = () => '123';
  douyinParser.parse = async () => {
    throw new Error('缓存命中时不应触发解析');
  };

  try {
    const result = await VideoService.parseVideo('https://v.douyin.com/short');
    assert.deepEqual(result, { title: 'cached-video' });
  } finally {
    cache.get = originalGet;
    douyinParser.resolveShortUrl = originalResolveShortUrl;
    douyinParser.extractVideoId = originalExtractVideoId;
    douyinParser.parse = originalParse;
  }
});

test('VideoService.getOrParseVideoData 在缓存未命中时写入缓存', async () => {
  const originalGet = cache.get;
  const originalSet = cache.set;
  const originalResolveShortUrl = douyinParser.resolveShortUrl;
  const originalExtractUrlFromText = douyinParser.extractUrlFromText;
  const originalExtractVideoId = douyinParser.extractVideoId;
  const originalParse = douyinParser.parse;

  const cacheWrites = [];
  cache.get = () => null;
  cache.set = (key, value, ttl) => cacheWrites.push({ key, value, ttl });
  douyinParser.extractUrlFromText = () => 'https://www.douyin.com/video/456';
  douyinParser.resolveShortUrl = async () => 'https://www.douyin.com/video/456';
  douyinParser.extractVideoId = () => '456';
  douyinParser.parse = async (url) => ({ title: 'parsed-video', url });

  try {
    const result = await VideoService.getOrParseVideoData('text', {
      parseLogLabel: 'download'
    });

    assert.equal(result.title, 'parsed-video');
    assert.equal(cacheWrites.length, 1);
    assert.equal(cacheWrites[0].key, '456');
    assert.equal(typeof cacheWrites[0].ttl, 'number');
  } finally {
    cache.get = originalGet;
    cache.set = originalSet;
    douyinParser.resolveShortUrl = originalResolveShortUrl;
    douyinParser.extractUrlFromText = originalExtractUrlFromText;
    douyinParser.extractVideoId = originalExtractVideoId;
    douyinParser.parse = originalParse;
  }
});

test('VideoService.parseVideo 在缓存未命中时使用真实地址解析', async () => {
  const originalGet = cache.get;
  const originalSet = cache.set;
  const originalResolveShortUrl = douyinParser.resolveShortUrl;
  const originalExtractUrlFromText = douyinParser.extractUrlFromText;
  const originalExtractVideoId = douyinParser.extractVideoId;
  const originalParse = douyinParser.parse;

  let parseInput = null;
  cache.get = () => null;
  cache.set = () => {};
  douyinParser.extractUrlFromText = () => 'https://v.douyin.com/short/';
  douyinParser.resolveShortUrl = async () => 'https://www.douyin.com/video/789';
  douyinParser.extractVideoId = () => '789';
  douyinParser.parse = async (url) => {
    parseInput = url;
    return { title: 'parsed-video' };
  };

  try {
    const result = await VideoService.parseVideo('share text https://v.douyin.com/short/');

    assert.equal(result.title, 'parsed-video');
    assert.equal(parseInput, 'https://www.douyin.com/video/789');
  } finally {
    cache.get = originalGet;
    cache.set = originalSet;
    douyinParser.resolveShortUrl = originalResolveShortUrl;
    douyinParser.extractUrlFromText = originalExtractUrlFromText;
    douyinParser.extractVideoId = originalExtractVideoId;
    douyinParser.parse = originalParse;
  }
});

test('VideoService.parseVideo 在短链解析失败返回原短链时通知解析器跳过二次解析', async () => {
  const originalGet = cache.get;
  const originalSet = cache.set;
  const originalResolveShortUrl = douyinParser.resolveShortUrl;
  const originalExtractUrlFromText = douyinParser.extractUrlFromText;
  const originalExtractVideoId = douyinParser.extractVideoId;
  const originalParse = douyinParser.parse;

  let parseInput = null;
  let parseOptions = null;
  const shortUrl = 'https://v.douyin.com/fail/';
  cache.get = () => null;
  cache.set = () => {};
  douyinParser.extractUrlFromText = () => shortUrl;
  douyinParser.resolveShortUrl = async () => shortUrl;
  douyinParser.extractVideoId = () => null;
  douyinParser.parse = async (url, options) => {
    parseInput = url;
    parseOptions = options;
    return { title: 'parsed-short-url' };
  };

  try {
    const result = await VideoService.parseVideo(`share text ${shortUrl}`);

    assert.equal(result.title, 'parsed-short-url');
    assert.equal(parseInput, shortUrl);
    assert.deepEqual(parseOptions, { skipShortUrlResolution: true });
  } finally {
    cache.get = originalGet;
    cache.set = originalSet;
    douyinParser.resolveShortUrl = originalResolveShortUrl;
    douyinParser.extractUrlFromText = originalExtractUrlFromText;
    douyinParser.extractVideoId = originalExtractVideoId;
    douyinParser.parse = originalParse;
  }
});

test('VideoService.getOrParseVideoData 应按 videoExpiresAt 收缩缓存 TTL', async () => {
  const originalNow = Date.now;
  const originalGet = cache.get;
  const originalSet = cache.set;
  const originalResolveShortUrl = douyinParser.resolveShortUrl;
  const originalExtractVideoId = douyinParser.extractVideoId;
  const originalParse = douyinParser.parse;

  const cacheWrites = [];
  Date.now = () => 1000000;
  cache.get = () => null;
  cache.set = (key, value, ttl) => cacheWrites.push({ key, value, ttl });
  douyinParser.resolveShortUrl = async () => 'https://www.douyin.com/video/999';
  douyinParser.extractVideoId = () => '999';
  douyinParser.parse = async () => ({
    title: 'ttl-video',
    videoExpiresAt: 1120
  });

  try {
    await VideoService.parseVideo('https://www.douyin.com/video/999');

    assert.equal(cacheWrites.length, 1);
    assert.equal(cacheWrites[0].ttl, 60000);
  } finally {
    Date.now = originalNow;
    cache.get = originalGet;
    cache.set = originalSet;
    douyinParser.resolveShortUrl = originalResolveShortUrl;
    douyinParser.extractVideoId = originalExtractVideoId;
    douyinParser.parse = originalParse;
  }
});

test('VideoService.getOrParseVideoData 在 CDN URL 过近过期时不写缓存', async () => {
  const originalNow = Date.now;
  const originalGet = cache.get;
  const originalSet = cache.set;
  const originalResolveShortUrl = douyinParser.resolveShortUrl;
  const originalExtractVideoId = douyinParser.extractVideoId;
  const originalParse = douyinParser.parse;

  let cacheWriteCount = 0;
  Date.now = () => 1000000;
  cache.get = () => null;
  cache.set = () => {
    cacheWriteCount += 1;
  };
  douyinParser.resolveShortUrl = async () => 'https://www.douyin.com/video/1000';
  douyinParser.extractVideoId = () => '1000';
  douyinParser.parse = async () => ({
    title: 'near-expired-video',
    videoExpiresAt: 1050
  });

  try {
    const result = await VideoService.parseVideo('https://www.douyin.com/video/1000');

    assert.equal(result.title, 'near-expired-video');
    assert.equal(cacheWriteCount, 0);
  } finally {
    Date.now = originalNow;
    cache.get = originalGet;
    cache.set = originalSet;
    douyinParser.resolveShortUrl = originalResolveShortUrl;
    douyinParser.extractVideoId = originalExtractVideoId;
    douyinParser.parse = originalParse;
  }
});
