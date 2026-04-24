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

test('parseDouyinVideoTool 在存在额外字段时抛出校验错误', async () => {
  await assert.rejects(
    () => parseDouyinVideoTool.execute({
      url: 'https://v.douyin.com/demo',
      extra: 'unexpected'
    }),
    (error) => {
      assert.equal(error.name, 'ZodError');
      assert.match(error.message, /unrecognized_keys|Unrecognized key/i);
      return true;
    }
  );
});

test('parseDouyinVideoTool 暴露 LangChain 兼容工具并复用 execute 逻辑', async () => {
  const originalParseVideo = VideoService.parseVideo;
  VideoService.parseVideo = async () => ({
    title: 'langchain-demo',
    author: 'tester',
    videoUrl: 'https://example.com/video.mp4',
    audioReady: false,
    audioUrl: null,
    duration: 500,
    cover: 'https://example.com/cover.jpg',
    source: 'mock'
  });

  try {
    assert.ok(parseDouyinVideoTool.langChainTool);
    assert.equal(parseDouyinVideoTool.langChainTool.name, parseDouyinVideoTool.name);

    const result = await parseDouyinVideoTool.langChainTool.invoke({
      url: 'https://v.douyin.com/langchain'
    });

    assert.equal(result.title, 'langchain-demo');
    assert.equal(result.shareUrl, 'https://v.douyin.com/langchain');
  } finally {
    VideoService.parseVideo = originalParseVideo;
  }
});
