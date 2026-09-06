const test = require('node:test');
const assert = require('node:assert/strict');

const axios = require('axios');
const bilibiliParser = require('../utils/bilibiliParser');
const cache = require('../utils/cache');

function createViewData() {
  return {
    aid: 1001,
    bvid: 'BV1TF8G6oERL',
    cid: 2002,
    title: 'B站测试视频',
    pic: 'https://example.com/cover.jpg',
    duration: 12,
    owner: {
      name: '测试UP'
    },
    pages: [
      {
        cid: 2002,
        page: 1,
        part: 'P1',
        duration: 12
      }
    ]
  };
}

function createPlayData(overrides = {}) {
  return {
    quality: 64,
    dash: {
      video: [
        {
          id: 80,
          baseUrl: 'https://example.com/h265.m4s?deadline=2000',
          bandwidth: 4000,
          mimeType: 'video/mp4',
          codecs: 'hev1',
          width: 1920,
          height: 1080
        },
        {
          id: 64,
          baseUrl: 'https://example.com/h264.m4s?deadline=2000',
          backupUrl: ['https://example.com/h264-backup.m4s?deadline=2000'],
          bandwidth: 3000,
          mimeType: 'video/mp4',
          codecs: 'avc1.640028',
          width: 1280,
          height: 720
        }
      ],
      audio: [
        {
          id: 30216,
          baseUrl: 'https://example.com/audio-low.m4s?deadline=2000',
          bandwidth: 64000,
          mimeType: 'audio/mp4',
          codecs: 'mp4a.40.2'
        },
        {
          id: 30232,
          baseUrl: 'https://example.com/audio-high.m4s?deadline=2000',
          backupUrl: ['https://example.com/audio-high-backup.m4s?deadline=2000'],
          bandwidth: 128000,
          mimeType: 'audio/mp4',
          codecs: 'mp4a.40.2'
        }
      ]
    },
    ...overrides
  };
}

test('bilibiliParser.extractBvid 支持视频页和分享文本', () => {
  assert.equal(
    bilibiliParser.extractBvid('https://www.bilibili.com/video/BV1TF8G6oERL/?spm_id_from=333'),
    'BV1TF8G6oERL'
  );
  assert.equal(
    bilibiliParser.extractBvid('帮我解析 BV1TF8G6oERL 这个视频'),
    'BV1TF8G6oERL'
  );
});

test('bilibiliParser.selectBestVideoStream 优先选择 H.264 兼容流', () => {
  const stream = bilibiliParser.selectBestVideoStream(createPlayData().dash.video);

  assert.equal(stream.codecs, 'avc1.640028');
  assert.equal(stream.id, 64);
});

test('bilibiliParser.selectBestAudioStream 选择最高码率音频流', () => {
  const stream = bilibiliParser.selectBestAudioStream(createPlayData().dash.audio);

  assert.equal(stream.id, 30232);
  assert.equal(stream.bandwidth, 128000);
});

test('bilibiliParser.parse 返回兼容现有解析契约的字段', async () => {
  const originalGet = axios.get;
  const requests = [];

  axios.get = async (url) => {
    requests.push(url);
    if (url.includes('/x/web-interface/view')) {
      return { data: { code: 0, data: createViewData() } };
    }
    if (url.includes('/x/player/pagelist')) {
      return {
        data: {
          code: 0,
          data: [{ cid: 2002, page: 1, part: 'P1', duration: 12 }]
        }
      };
    }
    if (url.includes('/x/player/playurl')) {
      return { data: { code: 0, data: createPlayData() } };
    }
    throw new Error('unexpected request');
  };

  try {
    const result = await bilibiliParser.parse('https://www.bilibili.com/video/BV1TF8G6oERL/');

    assert.equal(result.platform, 'bilibili');
    assert.equal(result.source, 'bilibili_playurl');
    assert.equal(result.title, 'B站测试视频');
    assert.equal(result.author, '测试UP');
    assert.equal(result.duration, 12000);
    assert.equal(result.videoUrl, 'https://example.com/h264.m4s?deadline=2000');
    assert.equal(result.audioUrl, 'https://example.com/audio-high.m4s?deadline=2000');
    assert.equal(result.audioReady, true);
    assert.equal(result.requiresMuxing, true);
    assert.equal(result.videoExpiresAt, 2000);
    assert.equal(result.bilibili.cid, 2002);
    assert.equal(requests.length, 3);
  } finally {
    axios.get = originalGet;
  }
});

test('bilibiliParser.parse 在无视频流时失败', async () => {
  const originalGet = axios.get;

  axios.get = async (url) => {
    if (url.includes('/x/web-interface/view')) {
      return { data: { code: 0, data: createViewData() } };
    }
    if (url.includes('/x/player/pagelist')) {
      return { data: { code: 0, data: [{ cid: 2002, page: 1, part: 'P1' }] } };
    }
    return {
      data: {
        code: 0,
        data: createPlayData({ dash: { video: [], audio: [] } })
      }
    };
  };

  try {
    await assert.rejects(
      () => bilibiliParser.parse('https://www.bilibili.com/video/BV1TF8G6oERL/'),
      /Bilibili video stream unavailable/
    );
  } finally {
    axios.get = originalGet;
  }
});

test('bilibiliParser.parse 在无音频流时失败，避免返回无声 DASH 视频', async () => {
  const originalGet = axios.get;

  axios.get = async (url) => {
    if (url.includes('/x/web-interface/view')) {
      return { data: { code: 0, data: createViewData() } };
    }
    if (url.includes('/x/player/pagelist')) {
      return { data: { code: 0, data: [{ cid: 2002, page: 1, part: 'P1' }] } };
    }
    return {
      data: {
        code: 0,
        data: createPlayData({ dash: { video: createPlayData().dash.video, audio: [] } })
      }
    };
  };

  try {
    await assert.rejects(
      () => bilibiliParser.parse('https://www.bilibili.com/video/BV1TF8G6oERL/'),
      /Bilibili audio stream unavailable/
    );
  } finally {
    axios.get = originalGet;
  }
});

test('bilibiliParser.resolveShortUrl 解析并缓存 b23.tv 跳转地址', async () => {
  const originalRequest = axios.request;
  const shortUrl = 'https://b23.tv/abc123';
  let requestCount = 0;

  cache.clear();
  axios.request = async (options) => {
    requestCount += 1;
    assert.equal(options.method, 'HEAD');
    assert.equal(options.maxRedirects, 0);
    return {
      headers: {
        location: 'https://www.bilibili.com/video/BV1TF8G6oERL/'
      }
    };
  };

  try {
    const first = await bilibiliParser.resolveShortUrl(shortUrl);
    const second = await bilibiliParser.resolveShortUrl(shortUrl);

    assert.equal(first, 'https://www.bilibili.com/video/BV1TF8G6oERL/');
    assert.equal(second, 'https://www.bilibili.com/video/BV1TF8G6oERL/');
    assert.equal(requestCount, 1);
  } finally {
    axios.request = originalRequest;
    cache.clear();
  }
});
