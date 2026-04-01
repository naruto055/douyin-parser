const test = require('node:test');
const assert = require('node:assert/strict');

const DownloadService = require('../services/DownloadService');
const VideoService = require('../services/VideoService');
const audioExtractor = require('../utils/audioExtractor');

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
      (error) => error.message === 'No audio or video URL available' && error.statusCode === 400
    );
  } finally {
    VideoService.getOrParseVideoData = originalGetOrParseVideoData;
  }
});
