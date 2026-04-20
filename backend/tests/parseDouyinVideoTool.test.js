const test = require('node:test');
const assert = require('node:assert/strict');

const VideoService = require('../services/VideoService');
const parseDouyinVideoTool = require('../services/tools/parseDouyinVideoTool');

test('parseDouyinVideoTool 调用 VideoService 并保留 shareUrl', async () => {
  const originalParseVideo = VideoService.parseVideo;
  VideoService.parseVideo = async (url) => ({
    title: 'demo',
    author: 'tester',
    videoUrl: 'https://example.com/video.mp4',
    audioReady: true,
    audioUrl: 'https://example.com/audio.mp3',
    duration: 1000,
    cover: 'https://example.com/cover.jpg',
    source: 'mock'
  });

  try {
    const result = await parseDouyinVideoTool.execute({
      url: 'https://v.douyin.com/demo'
    });

    assert.equal(result.title, 'demo');
    assert.equal(result.shareUrl, 'https://v.douyin.com/demo');
  } finally {
    VideoService.parseVideo = originalParseVideo;
  }
});

test('parseDouyinVideoTool 在缺少 url 时抛出校验错误', async () => {
  await assert.rejects(() => parseDouyinVideoTool.execute({}), /Invalid input/);
});
