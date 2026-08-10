const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { sanitizeFilename } = require('../utils/stringUtil');
const { isDirectMediaUrl } = require('../utils/urlValidator');
const {
  parse,
  extractVideoInfo,
  normalizeDouyinPageUrl,
  resolveShortUrl,
  shouldResolveShortUrl,
  sanitizeUrlForLog

} = require('../utils/douyinParser');
const browserPool = require('../utils/browserPool');
const thirdPartyAPI = require('../utils/thirdPartyAPI');
const { normalizeParseResult } = require('../utils/parseResultNormalizer');
const {
  createPuppeteerDiagnostics,
  enableLightweightRequestInterception,
  waitForAwemeDetail
} = require('../utils/browserPool');

test('sanitizeFilename 应替换非法字符并限制长度', () => {
  const filename = 'a<test>:video?name*' + 'x'.repeat(120);
  const result = sanitizeFilename(filename);

  assert.equal(result.includes('<'), false);
  assert.equal(result.includes(':'), false);
  assert.equal(result.length, 100);
});

test('isDirectMediaUrl 应识别带扩展名的媒体链接', () => {
  assert.equal(isDirectMediaUrl('https://example.com/demo.mp4'), true);
});

test('isDirectMediaUrl 应识别已知媒体域名', () => {
  assert.equal(isDirectMediaUrl('https://media.douyinvod.com/play'), true);
});

test('isDirectMediaUrl 对抖音页面链接返回 false', () => {
  assert.equal(isDirectMediaUrl('https://www.douyin.com/video/1234567890'), false);
});

test('shouldResolveShortUrl 对已包含视频 ID 的长链返回 false', () => {
  assert.equal(shouldResolveShortUrl('https://www.douyin.com/video/1234567890?from=copy'), false);
});

test('shouldResolveShortUrl 对 v.douyin.com 短链返回 true', () => {
  assert.equal(shouldResolveShortUrl('https://v.douyin.com/abc123/'), true);
});

test('sanitizeUrlForLog 应移除 query 参数', () => {
  assert.equal(
    sanitizeUrlForLog('https://www.douyin.com/video/1234567890?msToken=secret&a_bogus=secret'),
    'https://www.douyin.com/video/1234567890'
  );
});

test('normalizeDouyinPageUrl 应将 iesdouyin 分享页转为 douyin 视频页', () => {
  assert.equal(
    normalizeDouyinPageUrl('https://www.iesdouyin.com/share/video/7654080371546054314/?region=CN'),
    'https://www.douyin.com/video/7654080371546054314'
  );
});

test('normalizeParseResult 应为三方简字段补齐统一结果模型', () => {
  const result = normalizeParseResult({
    source: 'jxcxin',
    title: 'third-party-video',
    videoUrl: 'https://example.com/video.mp4',
    audioUrl: 'https://example.com/audio.mp3'
  });

  assert.equal(result.source, 'jxcxin');
  assert.equal(result.title, 'third-party-video');
  assert.equal(result.videoUrl, 'https://example.com/video.mp4');
  assert.deepEqual(result.videoBackupUrls, []);
  assert.equal(result.videoCodec, '');
  assert.equal(result.videoWidth, 0);
  assert.equal(result.videoExpiresAt, 0);
  assert.equal(result.audioReady, true);
  assert.deepEqual(result.audioBackupUrls, []);
  assert.equal(result.puppeteerDiagnostics, null);
  assert.equal(result.fallbackReason, '');
});

test('normalizeParseResult 应保留 Puppeteer 富字段并规范化基础类型', () => {
  const diagnostics = { detailApiValid: true };
  const result = normalizeParseResult({
    source: 'puppeteer',
    duration: '1200',
    videoBackupUrls: ['https://example.com/video.mp4', ''],
    videoCodec: 'h264',
    videoWidth: '1080',
    videoHeight: 1920,
    audioReady: false,
    puppeteerDiagnostics: diagnostics
  });

  assert.equal(result.duration, 1200);
  assert.deepEqual(result.videoBackupUrls, ['https://example.com/video.mp4']);
  assert.equal(result.videoCodec, 'h264');
  assert.equal(result.videoWidth, 1080);
  assert.equal(result.videoHeight, 1920);
  assert.equal(result.audioReady, false);
  assert.equal(result.puppeteerDiagnostics, diagnostics);
});

test('parse 应在 HTTP 详情接口成功时跳过 Puppeteer 并返回统一模型', async () => {
  const originalGet = axios.get;
  const originalExecute = browserPool.execute;
  let httpCalled = false;
  let puppeteerCalled = false;

  axios.get = async (url, options) => {
    httpCalled = true;
    assert.match(url, /aweme_id=1234567890/);
    assert.equal(options.timeout, 2500);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(url.includes('a_bogus='), false);

    return {
      data: {
        status_code: 0,
        aweme_detail: {
          desc: 'http-detail-title',
          author: { nickname: 'http-author' },
          video: {
            duration: 1000,
            cover: { url_list: ['https://example.com/http.jpg'] },
            play_addr_h264: { url_list: ['https://example.com/http.mp4'] }
          }
        }
      }
    };
  };
  browserPool.execute = async () => {
    puppeteerCalled = true;
    throw new Error('Puppeteer should not be called');
  };

  try {
    const result = await parse('https://www.douyin.com/video/1234567890', {
      skipShortUrlResolution: true
    });

    assert.equal(httpCalled, true);
    assert.equal(puppeteerCalled, false);
    assert.equal(result.source, 'http_detail');
    assert.equal(result.title, 'http-detail-title');
    assert.equal(result.author, 'http-author');
    assert.equal(result.videoUrl, 'https://example.com/http.mp4');
    assert.equal(result.audioReady, false);
  } finally {
    axios.get = originalGet;
    browserPool.execute = originalExecute;
  }
});

test('parse 应在 HTTP 详情接口失败时降级 Puppeteer', async () => {
  const originalGet = axios.get;
  const originalExecute = browserPool.execute;
  let puppeteerCalled = false;

  axios.get = async () => {
    throw new Error('http detail failed');
  };
  browserPool.execute = async () => {
    puppeteerCalled = true;
    return {
      aweme_detail: {
        desc: 'puppeteer-title',
        author: { nickname: 'puppeteer-author' },
        video: {
          duration: 1000,
          cover: { url_list: ['https://example.com/puppeteer.jpg'] },
          play_addr_h264: { url_list: ['https://example.com/puppeteer.mp4'] }
        }
      }
    };
  };

  try {
    const result = await parse('https://www.douyin.com/video/1234567890', {
      skipShortUrlResolution: true
    });

    assert.equal(puppeteerCalled, true);
    assert.equal(result.source, 'puppeteer');
    assert.equal(result.title, 'puppeteer-title');
    assert.equal(result.videoUrl, 'https://example.com/puppeteer.mp4');
  } finally {
    axios.get = originalGet;
    browserPool.execute = originalExecute;
  }
});

test('parse 在无 aweme_id 时不调用 HTTP 快速路径', async () => {
  const originalGet = axios.get;
  const originalExecute = browserPool.execute;
  let httpCalled = false;

  axios.get = async () => {
    httpCalled = true;
    throw new Error('HTTP detail should not be called');
  };
  browserPool.execute = async () => ({
    aweme_detail: {
      desc: 'no-id-title',
      video: {
        cover: { url_list: ['https://example.com/no-id.jpg'] },
        play_addr_h264: { url_list: ['https://example.com/no-id.mp4'] }
      }
    }
  });

  try {
    const result = await parse('https://www.douyin.com/search/test', {
      skipShortUrlResolution: true
    });

    assert.equal(httpCalled, false);
    assert.equal(result.title, 'no-id-title');
    assert.equal(result.videoUrl, 'https://example.com/no-id.mp4');
  } finally {
    axios.get = originalGet;
    browserPool.execute = originalExecute;
  }
});

test('parse 在 Puppeteer 失败后应使用第三方兜底并返回统一模型', async () => {
  const originalGet = axios.get;
  const originalExecute = browserPool.execute;
  const originalParseWithThirdParty = thirdPartyAPI.parseWithThirdParty;
  const diagnostics = { detailApiValid: false, fallback: 'page_meta' };

  axios.get = async () => {
    throw new Error('http detail failed');
  };
  browserPool.execute = async () => ({
    title: '',
    cover: '',
    __diagnostics: diagnostics
  });
  thirdPartyAPI.parseWithThirdParty = async () => ({
    source: 'jxcxin',
    title: 'fallback-video',
    videoUrl: 'https://example.com/fallback.mp4',
    audioUrl: 'https://example.com/fallback.mp3'
  });

  try {
    const result = await parse('https://www.douyin.com/video/1234567890', {
      skipShortUrlResolution: true
    });

    assert.equal(result.source, 'jxcxin');
    assert.equal(result.title, 'fallback-video');
    assert.equal(result.videoUrl, 'https://example.com/fallback.mp4');
    assert.equal(result.audioReady, true);
    assert.equal(result.puppeteerDiagnostics, diagnostics);
    assert.equal(result.fallbackReason, 'Puppeteer parse returned no useful data');
    assert.deepEqual(result.videoBackupUrls, []);
  } finally {
    axios.get = originalGet;
    browserPool.execute = originalExecute;
    thirdPartyAPI.parseWithThirdParty = originalParseWithThirdParty;
  }
});

test('parse 在 Puppeteer 和第三方均失败时应保留诊断和第三方错误', async () => {
  const originalGet = axios.get;
  const originalExecute = browserPool.execute;
  const originalParseWithThirdParty = thirdPartyAPI.parseWithThirdParty;
  const diagnostics = { detailApiValid: false };

  axios.get = async () => {
    throw new Error('http detail failed');
  };
  browserPool.execute = async () => ({
    title: '',
    cover: '',
    __diagnostics: diagnostics
  });
  thirdPartyAPI.parseWithThirdParty = async () => {
    throw new Error('All third-party APIs failed');
  };

  try {
    await assert.rejects(
      () => parse('https://www.douyin.com/video/1234567890', { skipShortUrlResolution: true }),
      (error) => {
        assert.equal(error.message, 'All third-party APIs failed');
        assert.deepEqual(error.data, {
          puppeteerDiagnostics: diagnostics,
          fallbackReason: 'Puppeteer parse returned no useful data',
          thirdPartyError: 'All third-party APIs failed'
        });
        return true;
      }
    );
  } finally {
    axios.get = originalGet;
    browserPool.execute = originalExecute;
    thirdPartyAPI.parseWithThirdParty = originalParseWithThirdParty;
  }
});

test('第三方 provider 返回结果应归一化为统一解析模型', async () => {
  const originalGet = axios.get;
  const calls = [];

  axios.get = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('xinyew')) {
      return {
        data: {
          code: 200,
          data: {
            title: 'xinyew-title',
            nickname: 'xinyew-author',
            cover_url: 'https://example.com/xinyew.jpg',
            duration: '1500',
            video_url: 'https://example.com/xinyew.mp4',
            music: 'https://example.com/xinyew.mp3'
          }
        }
      };
    }

    if (url.includes('jxcxin')) {
      return {
        data: {
          success: true,
          data: {
            title: 'jxcxin-title',
            video: 'https://example.com/jxcxin.mp4',
            audio: 'https://example.com/jxcxin.mp3'
          }
        }
      };
    }

    return {
      data: {
        code: 200,
        data: {
          title: 'devtool-title',
          url: 'https://example.com/devtool.mp4'
        }
      }
    };
  };

  try {
    const xinyew = await thirdPartyAPI.callXinyeApi('https://www.douyin.com/video/1');
    const jxcxin = await thirdPartyAPI.callChuangxinApi('https://www.douyin.com/video/2');
    const devtool = await thirdPartyAPI.callDevtoolApi('https://www.douyin.com/video/3');

    assert.equal(xinyew.source, 'xinyew');
    assert.equal(xinyew.author, 'xinyew-author');
    assert.equal(xinyew.duration, 1500);
    assert.equal(xinyew.audioReady, true);
    assert.deepEqual(xinyew.videoBackupUrls, []);

    assert.equal(jxcxin.source, 'jxcxin');
    assert.equal(jxcxin.videoUrl, 'https://example.com/jxcxin.mp4');
    assert.equal(jxcxin.audioReady, true);
    assert.equal(jxcxin.puppeteerDiagnostics, null);

    assert.equal(devtool.source, 'devtool');
    assert.equal(devtool.videoUrl, 'https://example.com/devtool.mp4');
    assert.equal(devtool.audioReady, false);
    assert.equal(devtool.fallbackReason, '');
    assert.equal(calls.length, 3);
  } finally {
    axios.get = originalGet;
  }
});

test('resolveShortUrl 对已包含视频 ID 的长链跳过网络请求', async () => {
  const originalHead = axios.head;
  const originalGet = axios.get;

  axios.head = async () => {
    throw new Error('长链不应发起 HEAD 请求');
  };
  axios.get = async () => {
    throw new Error('长链不应发起 GET 请求');
  };

  try {
    const url = 'https://www.douyin.com/video/1234567890';
    assert.equal(await resolveShortUrl(url), url);
  } finally {
    axios.head = originalHead;
    axios.get = originalGet;
  }
});

test('resolveShortUrl 对短链使用短超时 HEAD 解析', async () => {
  const originalHead = axios.head;
  const originalGet = axios.get;
  const calls = [];

  axios.head = async (url, options) => {
    calls.push({ url, options });
    return {
      request: {
        res: {
          responseUrl: 'https://www.douyin.com/video/1234567890'
        }
      }
    };
  };
  axios.get = async () => {
    throw new Error('HEAD 成功时不应发起 GET 请求');
  };

  try {
    const result = await resolveShortUrl('https://v.douyin.com/abc123/');
    assert.equal(result, 'https://www.douyin.com/video/1234567890');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.timeout, 4000);
    assert.equal(calls[0].options.maxRedirects, 5);
  } finally {
    axios.head = originalHead;
    axios.get = originalGet;
  }
});

test('resolveShortUrl 在 HEAD 失败但有 location 时使用跳转地址', async () => {
  const originalHead = axios.head;
  const originalGet = axios.get;

  axios.head = async () => {
    const error = new Error('head failed');
    error.response = {
      headers: {
        location: 'https://www.douyin.com/video/2233'
      }
    };
    throw error;
  };
  axios.get = async () => {
    throw new Error('存在 location 时不应发起 GET 请求');
  };

  try {
    assert.equal(await resolveShortUrl('https://v.douyin.com/location/'), 'https://www.douyin.com/video/2233');
  } finally {
    axios.head = originalHead;
    axios.get = originalGet;
  }
});

test('resolveShortUrl 在 HEAD 失败后使用 GET 兜底', async () => {
  const originalHead = axios.head;
  const originalGet = axios.get;
  const getCalls = [];

  axios.head = async () => {
    throw new Error('head failed');
  };
  axios.get = async (url, options) => {
    getCalls.push({ url, options });
    return {
      request: {
        res: {
          responseUrl: 'https://www.douyin.com/video/3344'
        }
      }
    };
  };

  try {
    assert.equal(await resolveShortUrl('https://v.douyin.com/get/'), 'https://www.douyin.com/video/3344');
    assert.equal(getCalls.length, 1);
    assert.equal(getCalls[0].options.timeout, 4000);
    assert.equal(getCalls[0].options.maxRedirects, 5);
  } finally {
    axios.head = originalHead;
    axios.get = originalGet;
  }
});

test('resolveShortUrl 在 HEAD 和 GET 都失败时返回原短链', async () => {
  const originalHead = axios.head;
  const originalGet = axios.get;
  const url = 'https://v.douyin.com/fail/';

  axios.head = async () => {
    throw new Error('head failed');
  };
  axios.get = async () => {
    throw new Error('get failed');
  };

  try {
    assert.equal(await resolveShortUrl(url), url);
  } finally {
    axios.head = originalHead;
    axios.get = originalGet;
  }
});

test('extractVideoInfo 应优先选择 play_addr_h264 视频地址', () => {
  const result = extractVideoInfo({
    status_code: 0,
    aweme_detail: {
      desc: 'h264 video',
      video: {
        duration: 1200,
        cover: { url_list: ['https://example.com/cover.jpg'] },
        play_addr_h264: {
          url_list: ['https://example.com/h264.mp4', 'https://example.com/h264-backup.mp4'],
          width: 1080,
          height: 1920,
          bit_rate: 1900000
        },
        play_addr: {
          url_list: ['https://example.com/default.mp4']
        },
        cdn_url_expired: 1786082767
      },
      music: {
        title: 'bgm',
        author: 'artist',
        play_url: {
          url_list: ['https://example.com/music.mp3']
        }
      }
    }
  });

  assert.equal(result.videoUrl, 'https://example.com/h264.mp4');
  assert.deepEqual(result.videoBackupUrls, [
    'https://example.com/h264.mp4',
    'https://example.com/h264-backup.mp4'
  ]);
  assert.equal(result.videoCodec, 'h264');
  assert.equal(result.videoFormat, 'mp4');
  assert.equal(result.videoWidth, 1080);
  assert.equal(result.videoHeight, 1920);
  assert.equal(result.videoBitRate, 1900000);
  assert.equal(result.videoSource, 'play_addr_h264');
  assert.equal(result.videoExpiresAt, 1786082767);
  assert.equal(result.audioUrl, 'https://example.com/music.mp3');
  assert.equal(result.audioType, 'music');
  assert.equal(result.audioReady, true);
});

test('extractVideoInfo 应从对象 url_list 中提取真实媒体 URL', () => {
  const result = extractVideoInfo({
    aweme_detail: {
      video: {
        play_addr: {
          url_list: [{ url: 'https://example.com/video-object.mp4' }]
        }
      },
      music: {
        play_url: {
          url_list: [{ url: 'https://example.com/audio-object.mp3' }]
        }
      }
    }
  });

  assert.equal(result.videoUrl, 'https://example.com/video-object.mp4');
  assert.equal(result.audioUrl, 'https://example.com/audio-object.mp3');
  assert.equal(result.audioReady, true);
});

test('extractVideoInfo 应在无 play_addr_h264 时回退 play_addr', () => {
  const result = extractVideoInfo({
    aweme_detail: {
      video: {
        play_addr: {
          url_list: ['https://example.com/default.mp4'],
          width: 720,
          height: 1280
        }
      }
    }
  });

  assert.equal(result.videoUrl, 'https://example.com/default.mp4');
  assert.equal(result.videoSource, 'play_addr');
  assert.equal(result.videoCodec, 'h264');
});

test('extractVideoInfo 应从 bit_rate 中选择 H.264 最高清晰度', () => {
  const result = extractVideoInfo({
    aweme_detail: {
      video: {
        bit_rate: [
          {
            is_h265: 1,
            bit_rate: 3000000,
            play_addr: {
              width: 2160,
              height: 3840,
              url_list: ['https://example.com/h265.mp4']
            }
          },
          {
            is_h265: 0,
            bit_rate: 1000000,
            format: 'mp4',
            play_addr: {
              width: 720,
              height: 1280,
              url_list: ['https://example.com/720.mp4']
            }
          },
          {
            is_h265: 0,
            bit_rate: 1800000,
            format: 'mp4',
            play_addr: {
              width: 1080,
              height: 1920,
              url_list: ['https://example.com/1080.mp4']
            }
          }
        ]
      }
    }
  });

  assert.equal(result.videoUrl, 'https://example.com/1080.mp4');
  assert.equal(result.videoSource, 'bit_rate');
  assert.equal(result.videoWidth, 1080);
  assert.equal(result.videoHeight, 1920);
  assert.equal(result.videoBitRate, 1800000);
});

test('extractVideoInfo 只有 H.265 时不应默认填充 videoUrl', () => {
  const result = extractVideoInfo({
    aweme_detail: {
      video: {
        play_addr_265: {
          width: 1080,
          height: 1920,
          url_list: ['https://example.com/h265.mp4']
        }
      }
    }
  });

  assert.equal(result.videoUrl, '');
  assert.equal(result.video265Url, 'https://example.com/h265.mp4');
  assert.equal(result.video265Codec, 'h265');
});

test('extractVideoInfo 使用 download_addr 兜底时标记水印风险', () => {
  const result = extractVideoInfo({
    aweme_detail: {
      video: {
        download_addr: {
          url_list: ['https://example.com/download.mp4']
        }
      }
    }
  });

  assert.equal(result.videoUrl, 'https://example.com/download.mp4');
  assert.equal(result.videoSource, 'download_addr');
  assert.equal(result.videoWatermarkRisk, true);
});

test('extractVideoInfo 无 music.play_url 时不返回 audioUrl', () => {
  const result = extractVideoInfo({
    aweme_detail: {
      video: {
        play_addr: {
          url_list: ['https://example.com/video.mp4']
        }
      },
      music: {}
    }
  });

  assert.equal(result.audioReady, false);
  assert.equal(result.audioUrl, '');
});

test('enableLightweightRequestInterception 应吞掉 abort 和 continue 的异步失败', async () => {
  const handlers = {};
  const page = {
    setRequestInterception: async (enabled) => {
      assert.equal(enabled, true);
    },
    on: (eventName, handler) => {
      handlers[eventName] = handler;
    }
  };

  await enableLightweightRequestInterception(page);

  await assert.doesNotReject(() => handlers.request({
    resourceType: () => 'image',
    abort: async () => {
      throw new Error('abort failed');
    },
    continue: async () => {
      throw new Error('continue should not be called');
    }
  }));

  await assert.doesNotReject(() => handlers.request({
    resourceType: () => 'script',
    abort: async () => {
      throw new Error('abort should not be called');
    },
    continue: async () => {
      throw new Error('continue failed');
    }
  }));
});

test('waitForAwemeDetail 命中有效详情接口时应返回数据并写入诊断', async () => {
  const handlers = {};
  const page = {
    on: (eventName, handler) => {
      handlers[eventName] = handler;
    }
  };
  const diagnostics = createPuppeteerDiagnostics();
  const waitPromise = waitForAwemeDetail(page, diagnostics);

  await handlers.response({
    url: () => 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=123',
    status: () => 200,
    json: async () => ({
      status_code: 0,
      aweme_detail: {
        desc: 'detail-video'
      }
    })
  });

  const result = await waitPromise;

  assert.equal(result.aweme_detail.desc, 'detail-video');
  assert.equal(diagnostics.detailApiMatched, true);
  assert.equal(diagnostics.detailApiValid, true);
  assert.equal(diagnostics.detailHttpStatus, 200);
  assert.equal(diagnostics.detailStatusCode, 0);
  assert.equal(diagnostics.detailHasAweme, true);
  assert.equal(diagnostics.fallback, 'detail_api');
});
