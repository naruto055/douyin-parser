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
  cache.set = (key, value) => cacheWrites.push({ key, value });
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
  } finally {
    cache.get = originalGet;
    cache.set = originalSet;
    douyinParser.resolveShortUrl = originalResolveShortUrl;
    douyinParser.extractUrlFromText = originalExtractUrlFromText;
    douyinParser.extractVideoId = originalExtractVideoId;
    douyinParser.parse = originalParse;
  }
});
