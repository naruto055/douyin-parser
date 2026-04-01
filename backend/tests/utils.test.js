const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeFilename } = require('../utils/stringUtil');
const { isDirectMediaUrl } = require('../utils/urlValidator');

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
