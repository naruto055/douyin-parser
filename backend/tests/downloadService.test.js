const test = require('node:test');
const assert = require('node:assert/strict');

const DownloadService = require('../services/DownloadService');
const VideoService = require('../services/VideoService');
const audioExtractor = require('../utils/audioExtractor');
const ErrorCodes = require('../errors/errorCodes');

test('DownloadService.downloadVideo 使用解析结果标题生成文件名', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalStreamMedia = DownloadService.streamMedia;
  const streamCalls = [];

  VideoService.getOrParseVideoData = async () => ({
    title: 'video:title',
    videoUrl: 'https://example.com/video.mp4'
  });
  DownloadService.streamMedia = async (...args) => streamCalls.push(args);

  try {
    await DownloadService.downloadVideo('https://www.douyin.com/video/1', 'fallback', {});
    assert.equal(streamCalls.length, 1);
    assert.equal(streamCalls[0][0], 'https://example.com/video.mp4');
    assert.equal(streamCalls[0][2], 'video_title.mp4');
    assert.equal(streamCalls[0][3], 'video/mp4');
    assert.deepEqual(streamCalls[0][4], {
      headers: {
        Referer: 'https://www.douyin.com/video/1',
        Origin: 'https://www.douyin.com',
        'User-Agent': DownloadService.DEFAULT_BROWSER_UA
      }
    });
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    DownloadService.streamMedia = originalStreamMedia;
  }
});

test('DownloadService.downloadAudio 优先直连音频流', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalStreamMedia = DownloadService.streamMedia;
  const originalExtractAudioFromUrl = audioExtractor.extractAudioFromUrl;
  const streamCalls = [];

  VideoService.getOrParseVideoData = async () => ({
    title: 'audio:title',
    audioReady: true,
    audioUrl: 'https://example.com/audio.mp3'
  });
  DownloadService.streamMedia = async (...args) => streamCalls.push(args);
  audioExtractor.extractAudioFromUrl = async () => {
    throw new Error('直连音频时不应触发提取');
  };

  try {
    await DownloadService.downloadAudio('https://www.douyin.com/video/1', '', {}, () => {});
    assert.equal(streamCalls.length, 1);
    assert.equal(streamCalls[0][0], 'https://example.com/audio.mp3');
    assert.equal(streamCalls[0][2], 'audio_title.mp3');
    assert.equal(streamCalls[0][3], 'audio/mpeg');
    assert.deepEqual(streamCalls[0][4], {
      headers: {
        Referer: 'https://www.douyin.com/video/1',
        Origin: 'https://www.douyin.com',
        'User-Agent': DownloadService.DEFAULT_BROWSER_UA
      }
    });
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    DownloadService.streamMedia = originalStreamMedia;
    audioExtractor.extractAudioFromUrl = originalExtractAudioFromUrl;
  }
});

test('DownloadService.downloadAudio 在无可用媒体地址时抛出 400 错误', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;

  VideoService.getOrParseVideoData = async () => ({
    title: 'missing-media',
    audioReady: false,
    audioUrl: '',
    videoUrl: ''
  });

  try {
    await assert.rejects(
      () => DownloadService.downloadAudio('https://www.douyin.com/video/1', '', {}, () => {}),
      (error) =>
        error.message === 'No audio or video URL available' &&
        error.code === ErrorCodes.DOWNLOAD_RESOURCE_MISSING &&
        error.isBusiness === true &&
        error.httpStatus === 200
    );
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
  }
});

test('DownloadService.downloadVideo 在首次 403 时强制刷新解析结果后重试一次', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalStreamMedia = DownloadService.streamMedia;
  const parseCalls = [];
  const streamCalls = [];

  VideoService.getOrParseVideoData = async (url, options = {}) => {
    parseCalls.push(options);
    if (options.forceRefresh) {
      return {
        title: 'fresh-video',
        videoUrl: 'https://example.com/fresh.mp4'
      };
    }

    return {
      title: 'stale-video',
      videoUrl: 'https://example.com/stale.mp4'
    };
  };

  DownloadService.streamMedia = async (...args) => {
    streamCalls.push(args);
    if (streamCalls.length === 1) {
      const error = new Error('forbidden');
      error.response = { status: 403 };
      throw error;
    }
  };

  try {
    await DownloadService.downloadVideo('https://www.douyin.com/video/2', '', {});
    assert.equal(streamCalls.length, 2);
    assert.equal(streamCalls[0][0], 'https://example.com/stale.mp4');
    assert.equal(streamCalls[1][0], 'https://example.com/fresh.mp4');
    assert.equal(parseCalls.length, 2);
    assert.equal(parseCalls[0].forceRefresh, undefined);
    assert.equal(parseCalls[1].forceRefresh, true);
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    DownloadService.streamMedia = originalStreamMedia;
  }
});

test('DownloadService.downloadVideo 会清洗分享文案中的链接后再写入 Referer', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalStreamMedia = DownloadService.streamMedia;
  const streamCalls = [];
  const shareText = [
    '8.52 复制打开抖音，看看【测试用户】的视频',
    'https://www.iesdouyin.com/share/video/7604426431498532849/?region=CN',
    ' 09/01 abc:/ '
  ].join('\r\n');

  VideoService.getOrParseVideoData = async () => ({
    title: 'share-text-video',
    videoUrl: 'https://example.com/video.mp4'
  });
  DownloadService.streamMedia = async (...args) => streamCalls.push(args);

  try {
    await DownloadService.downloadVideo(shareText, '', {});
    assert.equal(streamCalls.length, 1);
    assert.deepEqual(streamCalls[0][4], {
      headers: {
        Referer: 'https://www.iesdouyin.com/share/video/7604426431498532849/?region=CN',
        Origin: 'https://www.douyin.com',
        'User-Agent': DownloadService.DEFAULT_BROWSER_UA
      }
    });
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    DownloadService.streamMedia = originalStreamMedia;
  }
});

test('DownloadService.downloadVideo 日志不输出完整媒体签名 URL', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalStreamMedia = DownloadService.streamMedia;
  const originalLog = console.log;
  const logs = [];

  VideoService.getOrParseVideoData = async () => ({
    title: 'signed-video',
    videoUrl: 'https://example.com/video.mp4?auth_key=secret&token=secret'
  });
  DownloadService.streamMedia = async () => {};
  console.log = (...args) => logs.push(args.join(' '));

  try {
    await DownloadService.downloadVideo('https://www.douyin.com/video/1', '', {});

    assert.equal(logs.some((line) => line.includes('https://example.com/video.mp4')), true);
    assert.equal(logs.some((line) => line.includes('auth_key=secret')), false);
    assert.equal(logs.some((line) => line.includes('token=secret')), false);
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    DownloadService.streamMedia = originalStreamMedia;
    console.log = originalLog;
  }
});

test('DownloadService.downloadAudio 日志不输出完整媒体签名 URL', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalStreamMedia = DownloadService.streamMedia;
  const originalLog = console.log;
  const logs = [];

  VideoService.getOrParseVideoData = async () => ({
    title: 'signed-audio',
    audioReady: true,
    audioUrl: 'https://example.com/audio.mp3?auth_key=secret&token=secret'
  });
  DownloadService.streamMedia = async () => {};
  console.log = (...args) => logs.push(args.join(' '));

  try {
    await DownloadService.downloadAudio('https://www.douyin.com/video/1', '', {}, () => {});

    assert.equal(logs.some((line) => line.includes('https://example.com/audio.mp3')), true);
    assert.equal(logs.some((line) => line.includes('auth_key=secret')), false);
    assert.equal(logs.some((line) => line.includes('token=secret')), false);
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    DownloadService.streamMedia = originalStreamMedia;
    console.log = originalLog;
  }
});

test('DownloadService.downloadAudio 在直连音频 403 时强制刷新后重试一次', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalStreamMedia = DownloadService.streamMedia;
  const parseCalls = [];
  const streamCalls = [];

  VideoService.getOrParseVideoData = async (url, options = {}) => {
    parseCalls.push(options);
    if (options.forceRefresh) {
      return {
        title: 'fresh-audio',
        audioReady: true,
        audioUrl: 'https://example.com/fresh.mp3'
      };
    }

    return {
      title: 'stale-audio',
      audioReady: true,
      audioUrl: 'https://example.com/stale.mp3'
    };
  };

  DownloadService.streamMedia = async (...args) => {
    streamCalls.push(args);
    if (streamCalls.length === 1) {
      const error = new Error('forbidden');
      error.response = { status: 403 };
      throw error;
    }
  };

  try {
    await DownloadService.downloadAudio('https://www.douyin.com/video/2', '', {}, () => {});

    assert.equal(streamCalls.length, 2);
    assert.equal(streamCalls[0][0], 'https://example.com/stale.mp3');
    assert.equal(streamCalls[1][0], 'https://example.com/fresh.mp3');
    assert.equal(parseCalls.length, 2);
    assert.equal(parseCalls[1].forceRefresh, true);
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    DownloadService.streamMedia = originalStreamMedia;
  }
});

test('DownloadService.downloadAudio 在直连音频失败时返回业务错误', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalStreamMedia = DownloadService.streamMedia;

  VideoService.getOrParseVideoData = async () => ({
    title: 'broken-audio',
    audioReady: true,
    audioUrl: 'https://example.com/broken.mp3'
  });
  DownloadService.streamMedia = async () => {
    throw new Error('upstream failed');
  };

  try {
    await assert.rejects(
      () => DownloadService.downloadAudio('https://www.douyin.com/video/1', '', {}, () => {}),
      (error) =>
        error.message === 'upstream failed' &&
        error.code === ErrorCodes.DOWNLOAD_RESOURCE_MISSING &&
        error.isBusiness === true
    );
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    DownloadService.streamMedia = originalStreamMedia;
  }
});

test('DownloadService.downloadAudio 抽取视频音轨时传递媒体请求头', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalExtractAudioFromUrl = audioExtractor.extractAudioFromUrl;
  let receivedContext = null;

  VideoService.getOrParseVideoData = async () => ({
    title: 'extract-audio',
    audioReady: false,
    audioUrl: '',
    videoUrl: 'https://example.com/video.mp4',
    userAgent: 'Custom UA'
  });
  audioExtractor.extractAudioFromUrl = async (url, requestContext) => {
    receivedContext = requestContext;
    throw new Error('ffmpeg failed');
  };

  try {
    await assert.rejects(
      () => DownloadService.downloadAudio('https://www.douyin.com/video/1', '', {}, () => {}),
      (error) =>
        error.message === 'ffmpeg failed' &&
        error.code === ErrorCodes.DOWNLOAD_RESOURCE_MISSING &&
        error.isBusiness === true
    );

    assert.deepEqual(receivedContext, {
      headers: {
        Referer: 'https://www.douyin.com/video/1',
        Origin: 'https://www.douyin.com',
        'User-Agent': 'Custom UA'
      }
    });
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    audioExtractor.extractAudioFromUrl = originalExtractAudioFromUrl;
  }
});

test('DownloadService.downloadAudio 在音频直连失败且有视频时回退抽取音轨', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalStreamMedia = DownloadService.streamMedia;
  const originalExtractAudioFromUrl = audioExtractor.extractAudioFromUrl;
  let extractedUrl = null;

  VideoService.getOrParseVideoData = async () => ({
    title: 'fallback-audio',
    audioReady: true,
    audioUrl: 'https://example.com/broken.mp3',
    videoUrl: 'https://example.com/video.mp4'
  });
  DownloadService.streamMedia = async () => {
    throw new Error('audio cdn failed');
  };
  audioExtractor.extractAudioFromUrl = async (url) => {
    extractedUrl = url;
    throw new Error('stop after fallback assertion');
  };

  try {
    await assert.rejects(
      () => DownloadService.downloadAudio('https://www.douyin.com/video/1', '', {}, () => {}),
      (error) =>
        error.message === 'stop after fallback assertion' &&
        error.code === ErrorCodes.DOWNLOAD_RESOURCE_MISSING &&
        error.isBusiness === true
    );

    assert.equal(extractedUrl, 'https://example.com/video.mp4');
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    DownloadService.streamMedia = originalStreamMedia;
    audioExtractor.extractAudioFromUrl = originalExtractAudioFromUrl;
  }
});

test('DownloadService.downloadAudio 遇到对象 audioUrl 时不应传给直连下载', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalStreamMedia = DownloadService.streamMedia;
  const originalExtractAudioFromUrl = audioExtractor.extractAudioFromUrl;
  let streamCalled = false;
  let extractedUrl = null;

  VideoService.getOrParseVideoData = async () => ({
    title: 'object-audio-url',
    audioReady: true,
    audioUrl: { url: 'https://example.com/audio.mp3' },
    videoUrl: 'https://example.com/video.mp4'
  });
  DownloadService.streamMedia = async () => {
    streamCalled = true;
  };
  audioExtractor.extractAudioFromUrl = async (url) => {
    extractedUrl = url;
    throw new Error('stop after object fallback assertion');
  };

  try {
    await assert.rejects(
      () => DownloadService.downloadAudio('https://www.douyin.com/video/1', '', {}, () => {}),
      (error) =>
        error.message === 'stop after object fallback assertion' &&
        error.code === ErrorCodes.DOWNLOAD_RESOURCE_MISSING &&
        error.isBusiness === true
    );

    assert.equal(streamCalled, false);
    assert.equal(extractedUrl, 'https://example.com/video.mp4');
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    DownloadService.streamMedia = originalStreamMedia;
    audioExtractor.extractAudioFromUrl = originalExtractAudioFromUrl;
  }
});
