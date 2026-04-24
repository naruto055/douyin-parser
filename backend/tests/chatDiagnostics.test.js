const test = require('node:test');
const assert = require('node:assert/strict');

const {
  summarizeRunResult,
  buildEventLogEntry
} = require('../public/chatDiagnostics');

test('summarizeRunResult 在工具调用成功时返回通过结果', () => {
  const summary = summarizeRunResult({
    expectedMode: 'tool',
    events: [
      { event: 'session', data: { sessionId: 'session-1' } },
      {
        event: 'tool_result',
        data: {
          parsedData: {
            title: '测试视频',
            shareUrl: 'https://v.douyin.com/test'
          },
          toolStatus: {
            status: 'resolved',
            warnings: []
          }
        }
      },
      {
        event: 'done',
        data: {
          reply: '解析完成',
          parsedData: {
            title: '测试视频',
            shareUrl: 'https://v.douyin.com/test'
          }
        }
      }
    ]
  });

  assert.equal(summary.status, 'pass');
  assert.match(summary.summary, /function calling/);
  assert.match(summary.summary, /通过/);
  assert.equal(summary.checks.toolTriggered.passed, true);
  assert.equal(summary.checks.replyReturned.passed, true);
});

test('summarizeRunResult 在工具场景未触发工具时返回失败结果', () => {
  const summary = summarizeRunResult({
    expectedMode: 'tool',
    events: [
      {
        event: 'done',
        data: {
          reply: '这是普通回复'
        }
      }
    ]
  });

  assert.equal(summary.status, 'fail');
  assert.equal(summary.checks.toolTriggered.passed, false);
});

test('summarizeRunResult 在普通对话成功但有工具警告时返回警告结果', () => {
  const summary = summarizeRunResult({
    expectedMode: 'chat',
    events: [
      {
        event: 'tool_result',
        data: {
          parsedData: {
            title: '占位链接视频'
          },
          toolStatus: {
            status: 'suspect',
            warnings: ['placeholder_share_url']
          }
        }
      },
      {
        event: 'done',
        data: {
          reply: '我已经帮你完成解析'
        }
      }
    ]
  });

  assert.equal(summary.status, 'warn');
  assert.equal(summary.checks.replyReturned.passed, true);
  assert.equal(summary.checks.toolWarnings.passed, false);
});

test('buildEventLogEntry 生成包含时间与摘要的日志项', () => {
  const expectedTimestamp = (() => {
    const localDate = new Date(2026, 3, 24, 12, 34, 56);
    const hours = String(localDate.getHours()).padStart(2, '0');
    const minutes = String(localDate.getMinutes()).padStart(2, '0');
    const seconds = String(localDate.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  })();
  const entry = buildEventLogEntry(
    'tool_result',
    {
      parsedData: {
        title: '日志测试',
        author: '作者A'
      },
      toolStatus: {
        status: 'resolved',
        warnings: []
      }
    },
    new Date(2026, 3, 24, 12, 34, 56)
  );

  assert.equal(entry.type, 'tool_result');
  assert.equal(entry.timestamp, expectedTimestamp);
  assert.match(entry.summary, /日志测试/);
  assert.match(entry.summary, /resolved/);
});
