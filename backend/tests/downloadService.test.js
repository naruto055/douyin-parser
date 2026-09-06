const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

const axios = require('axios');
const DownloadService = require('../services/DownloadService');
const VideoService = require('../services/VideoService');
const audioExtractor = require('../utils/audioExtractor');
const config = require('../config');
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

test('DownloadService.downloadVideo 对 B 站 DASH 流触发音视频合并', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalDownloadTempMedia = DownloadService._downloadTempMedia;
  const originalBuildTempFilePath = DownloadService._buildTempFilePath;
  const originalStreamLocalFile = DownloadService._streamLocalFile;
  const originalRemoveFileIfExists = DownloadService._removeFileIfExists;
  const originalMergeVideoAndAudio = audioExtractor.mergeVideoAndAudio;

  const downloadedUrls = [];
  const removedFiles = [];
  let mergeArgs = null;
  let streamArgs = null;
  let startedDownloads = 0;
  let maxConcurrentDownloads = 0;
  let releaseDownloads;
  const downloadsReleased = new Promise((resolve) => {
    releaseDownloads = resolve;
  });

  VideoService.getOrParseVideoData = async () => ({
    platform: 'bilibili',
    title: 'bili:title',
    videoUrl: 'https://example.com/video.m4s',
    audioUrl: 'https://example.com/audio.m4s',
    requiresMuxing: true,
    referer: 'https://www.bilibili.com/video/BV1TF8G6oERL/',
    userAgent: 'Bili UA'
  });
  DownloadService._downloadTempMedia = async (url) => {
    downloadedUrls.push(url);
    startedDownloads += 1;
    maxConcurrentDownloads = Math.max(maxConcurrentDownloads, startedDownloads);
    if (startedDownloads === 2) {
      releaseDownloads();
    }
    await downloadsReleased;
    startedDownloads -= 1;
    return url.includes('video') ? 'video-temp.m4v' : 'audio-temp.m4a';
  };
  DownloadService._buildTempFilePath = () => 'muxed-output.mp4';
  audioExtractor.mergeVideoAndAudio = async (...args) => {
    mergeArgs = args;
  };
  DownloadService._streamLocalFile = (...args) => {
    streamArgs = args;
  };
  DownloadService._removeFileIfExists = (filePath) => removedFiles.push(filePath);

  try {
    await DownloadService.downloadVideo('https://www.bilibili.com/video/BV1TF8G6oERL/', '', {});

    assert.deepEqual(downloadedUrls, [
      'https://example.com/video.m4s',
      'https://example.com/audio.m4s'
    ]);
    assert.equal(maxConcurrentDownloads, 2);
    assert.equal(mergeArgs[0], 'video-temp.m4v');
    assert.equal(mergeArgs[1], 'audio-temp.m4a');
    assert.equal(mergeArgs[2], 'muxed-output.mp4');
    assert.equal(mergeArgs[3].signal instanceof AbortSignal, true);
    assert.deepEqual(streamArgs, ['muxed-output.mp4', {}, 'bili_title.mp4', 'video/mp4']);
    assert.deepEqual(removedFiles, ['video-temp.m4v', 'audio-temp.m4a']);
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    DownloadService._downloadTempMedia = originalDownloadTempMedia;
    DownloadService._buildTempFilePath = originalBuildTempFilePath;
    DownloadService._streamLocalFile = originalStreamLocalFile;
    DownloadService._removeFileIfExists = originalRemoveFileIfExists;
    audioExtractor.mergeVideoAndAudio = originalMergeVideoAndAudio;
  }
});

test('DownloadService.downloadVideo 对 B 站缺音频流直接返回业务错误', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalStreamMedia = DownloadService.streamMedia;
  let streamCalled = false;

  VideoService.getOrParseVideoData = async () => ({
    platform: 'bilibili',
    title: 'silent-video',
    videoUrl: 'https://example.com/video.m4s',
    audioUrl: '',
    requiresMuxing: false
  });
  DownloadService.streamMedia = async () => {
    streamCalled = true;
  };

  try {
    await assert.rejects(
      () => DownloadService.downloadVideo('https://www.bilibili.com/video/BV1TF8G6oERL/', '', {}),
      (error) =>
        error.code === ErrorCodes.DOWNLOAD_RESOURCE_MISSING &&
        error.message === 'Bilibili video download requires both video and audio streams'
    );
    assert.equal(streamCalled, false);
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    DownloadService.streamMedia = originalStreamMedia;
  }
});

test('DownloadService._downloadTempMedia 通过 Content-Length 拦截超限 B 站媒体', async () => {
  const originalRequest = axios.request;
  const originalMaxMediaBytes = config.bilibiliDownload.maxMediaBytes;

  config.bilibiliDownload.maxMediaBytes = 10;
  axios.request = async () => ({
    headers: {
      'content-length': '11'
    },
    data: Readable.from(['too-large'])
  });

  try {
    await assert.rejects(
      () => DownloadService._downloadTempMedia('https://example.com/video.m4s', { headers: {} }, 'm4v'),
      (error) =>
        error.code === ErrorCodes.DOWNLOAD_RESOURCE_MISSING &&
        error.message === 'Bilibili media stream exceeds download size limit'
    );
  } finally {
    axios.request = originalRequest;
    config.bilibiliDownload.maxMediaBytes = originalMaxMediaBytes;
  }
});

test('DownloadService._downloadTempMedia 通过流式计数拦截超限 B 站媒体', async () => {
  const originalRequest = axios.request;
  const originalMaxMediaBytes = config.bilibiliDownload.maxMediaBytes;
  const originalBuildTempFilePath = DownloadService._buildTempFilePath;
  const tempPath = require('path').join(__dirname, '..', 'temp', 'test-over-limit.m4v');

  config.bilibiliDownload.maxMediaBytes = 3;
  DownloadService._buildTempFilePath = () => tempPath;
  axios.request = async () => ({
    headers: {},
    data: Readable.from([Buffer.from('abcd')])
  });

  try {
    await assert.rejects(
      () => DownloadService._downloadTempMedia('https://example.com/video.m4s', { headers: {} }, 'm4v'),
      (error) =>
        error.code === ErrorCodes.DOWNLOAD_RESOURCE_MISSING &&
        error.message === 'Bilibili media stream exceeds download size limit'
    );
  } finally {
    axios.request = originalRequest;
    config.bilibiliDownload.maxMediaBytes = originalMaxMediaBytes;
    DownloadService._buildTempFilePath = originalBuildTempFilePath;
    DownloadService._removeFileIfExists(tempPath);
  }
});

test('DownloadService._withBilibiliMuxSlot 限制同时合并数量', async () => {
  const originalMaxMuxConcurrency = config.bilibiliDownload.maxMuxConcurrency;
  const originalActiveCount = DownloadService.activeBilibiliMuxCount;
  const originalQueue = DownloadService.bilibiliMuxQueue;
  const events = [];

  config.bilibiliDownload.maxMuxConcurrency = 1;
  DownloadService.activeBilibiliMuxCount = 0;
  DownloadService.bilibiliMuxQueue = [];

  try {
    let releaseFirst;
    const first = DownloadService._withBilibiliMuxSlot(async () => {
      events.push('first-start');
      await new Promise((resolve) => {
        releaseFirst = resolve;
      });
      events.push('first-end');
    });
    const second = DownloadService._withBilibiliMuxSlot(async () => {
      events.push('second-start');
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ['first-start']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, ['first-start', 'first-end', 'second-start']);
  } finally {
    config.bilibiliDownload.maxMuxConcurrency = originalMaxMuxConcurrency;
    DownloadService.activeBilibiliMuxCount = originalActiveCount;
    DownloadService.bilibiliMuxQueue = originalQueue;
  }
});

test('DownloadService._createDownloadAbortState 在客户端断开时触发取消信号', () => {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.finished = false;

  const abortState = DownloadService._createDownloadAbortState(res);
  assert.equal(abortState.signal.aborted, false);

  res.emit('close');

  assert.equal(abortState.signal.aborted, true);
  abortState.dispose();
});

test('DownloadService.downloadVideo 在客户端断开时中止并清理并行下载', async () => {
  const originalDownloadTempMedia = DownloadService._downloadTempMedia;
  const originalBuildTempFilePath = DownloadService._buildTempFilePath;
  const originalRemoveFileIfExists = DownloadService._removeFileIfExists;
  const originalMergeVideoAndAudio = audioExtractor.mergeVideoAndAudio;
  const res = new EventEmitter();
  res.writableEnded = false;
  res.finished = false;
  const removedFiles = [];
  let videoStarted = false;
  let audioStarted = false;
  let abortObserved = false;

  DownloadService._buildTempFilePath = () => 'muxed-output.mp4';
  DownloadService._removeFileIfExists = (filePath) => removedFiles.push(filePath);
  DownloadService._downloadTempMedia = async (url, requestContext, extension, signal) => {
    if (url.includes('video')) {
      videoStarted = true;
      return 'video-temp.m4v';
    }

    audioStarted = true;
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        abortObserved = true;
        reject(new Error('download aborted'));
      }, { once: true });
    });
    return 'audio-temp.m4a';
  };
  audioExtractor.mergeVideoAndAudio = async () => {
    throw new Error('merge should not start after cancellation');
  };

  try {
    const downloadPromise = DownloadService._downloadMuxedVideo(
      'https://www.bilibili.com/video/BV1TF8G6oERL/',
      {
        platform: 'bilibili',
        videoUrl: 'https://example.com/video.m4s',
        audioUrl: 'https://example.com/audio.m4s',
        requiresMuxing: true
      },
      'bili_title',
      res
    );

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(videoStarted, true);
    assert.equal(audioStarted, true);
    res.emit('close');

    await assert.rejects(downloadPromise);
    assert.equal(abortObserved, true);
    assert.equal(removedFiles.includes('video-temp.m4v'), true);
    assert.equal(removedFiles.includes('audio-temp.m4a'), false);
  } finally {
    DownloadService._downloadTempMedia = originalDownloadTempMedia;
    DownloadService._buildTempFilePath = originalBuildTempFilePath;
    DownloadService._removeFileIfExists = originalRemoveFileIfExists;
    audioExtractor.mergeVideoAndAudio = originalMergeVideoAndAudio;
  }
});

test('DownloadService.downloadVideo 对 B 站合并失败返回业务错误', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalDownloadTempMedia = DownloadService._downloadTempMedia;
  const originalBuildTempFilePath = DownloadService._buildTempFilePath;
  const originalRemoveFileIfExists = DownloadService._removeFileIfExists;
  const originalMergeVideoAndAudio = audioExtractor.mergeVideoAndAudio;

  VideoService.getOrParseVideoData = async () => ({
    platform: 'bilibili',
    title: 'bili-broken',
    videoUrl: 'https://example.com/video.m4s',
    audioUrl: 'https://example.com/audio.m4s',
    requiresMuxing: true
  });
  DownloadService._downloadTempMedia = async () => 'temp-media';
  DownloadService._buildTempFilePath = () => 'muxed-output.mp4';
  DownloadService._removeFileIfExists = () => {};
  audioExtractor.mergeVideoAndAudio = async () => {
    const error = new Error('ffmpeg failed');
    error.code = 'ENOENT';
    throw error;
  };

  try {
    await assert.rejects(
      () => DownloadService.downloadVideo('https://www.bilibili.com/video/BV1TF8G6oERL/', '', {}),
      (error) =>
        error.code === ErrorCodes.DOWNLOAD_RESOURCE_MISSING &&
        error.message === 'FFmpeg executable not found. Please install ffmpeg or configure FFMPEG_PATH.' &&
        error.isBusiness === true
    );
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    DownloadService._downloadTempMedia = originalDownloadTempMedia;
    DownloadService._buildTempFilePath = originalBuildTempFilePath;
    DownloadService._removeFileIfExists = originalRemoveFileIfExists;
    audioExtractor.mergeVideoAndAudio = originalMergeVideoAndAudio;
  }
});

test('DownloadService.downloadAudio 对 B 站音频返回 m4a 文件', async () => {
  const originalGetOrParseVideoData = VideoService.getOrParseVideoData;
  const originalStreamMedia = DownloadService.streamMedia;
  const streamCalls = [];

  VideoService.getOrParseVideoData = async () => ({
    platform: 'bilibili',
    title: 'bili audio',
    audioReady: true,
    audioUrl: 'https://example.com/audio.m4s',
    audioMimeType: 'audio/mp4',
    audioFormat: 'm4a',
    referer: 'https://www.bilibili.com/video/BV1TF8G6oERL/'
  });
  DownloadService.streamMedia = async (...args) => streamCalls.push(args);

  try {
    await DownloadService.downloadAudio('https://www.bilibili.com/video/BV1TF8G6oERL/', '', {}, () => {});

    assert.equal(streamCalls.length, 1);
    assert.equal(streamCalls[0][0], 'https://example.com/audio.m4s');
    assert.equal(streamCalls[0][2], 'bili audio.m4a');
    assert.equal(streamCalls[0][3], 'audio/mp4');
    assert.deepEqual(streamCalls[0][4], {
      headers: {
        Referer: 'https://www.bilibili.com/video/BV1TF8G6oERL/',
        Origin: 'https://www.bilibili.com',
        'User-Agent': DownloadService.DEFAULT_BROWSER_UA
      }
    });
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
    DownloadService.streamMedia = originalStreamMedia;
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
