(function (globalScope) {
  function summarizeRunResult({ expectedMode = 'chat', events = [] } = {}) {
    const normalizedEvents = Array.isArray(events) ? events : [];
    const doneEvent = normalizedEvents.find((item) => item?.event === 'done');
    const errorEvent = normalizedEvents.find((item) => item?.event === 'error');
    const toolEvent = [...normalizedEvents]
      .reverse()
      .find((item) => item?.event === 'tool_result' && item?.data?.parsedData);
    const toolStatus = toolEvent?.data?.toolStatus || doneEvent?.data?.toolStatus || null;
    const hasReply = Boolean(String(doneEvent?.data?.reply || '').trim());
    const hasToolResult = Boolean(toolEvent?.data?.parsedData || doneEvent?.data?.parsedData);
    const hasWarnings = Array.isArray(toolStatus?.warnings) && toolStatus.warnings.length > 0;

    const checks = {
      replyReturned: {
        label: '返回最终回复',
        passed: hasReply,
        detail: hasReply ? 'done 事件包含 reply。' : 'done 事件缺少有效 reply。'
      },
      toolTriggered: {
        label: '触发 function calling',
        passed: hasToolResult,
        detail: hasToolResult ? '检测到 tool_result/parsedData。' : '未检测到工具调用结果。'
      },
      toolWarnings: {
        label: '工具结果无告警',
        passed: !hasWarnings,
        detail: hasWarnings ? `toolStatus.warnings=${toolStatus.warnings.join(', ')}` : '未发现 toolStatus 告警。'
      }
    };

    if (errorEvent) {
      return {
        status: 'fail',
        summary: `测试失败：接口返回错误，${String(errorEvent.data?.error || '未知错误')}`,
        checks,
        toolStatus
      };
    }

    if (expectedMode === 'tool') {
      if (!hasToolResult) {
        return {
          status: 'fail',
          summary: 'function calling 测试失败：未检测到工具调用结果。',
          checks,
          toolStatus
        };
      }

      if (!hasReply) {
        return {
          status: 'fail',
          summary: 'function calling 测试失败：工具调用后没有形成最终回复。',
          checks,
          toolStatus
        };
      }

      if (hasWarnings) {
        return {
          status: 'warn',
          summary: 'function calling 测试通过，但工具结果存在告警。',
          checks,
          toolStatus
        };
      }

      return {
        status: 'pass',
        summary: 'function calling 测试通过：已触发工具调用，并返回最终回复。',
        checks,
        toolStatus
      };
    }

    if (!hasReply) {
      return {
        status: 'fail',
        summary: '普通对话测试失败：未返回最终回复。',
        checks,
        toolStatus
      };
    }

    if (hasWarnings) {
      return {
        status: 'warn',
        summary: '普通对话测试通过，但工具结果存在告警。',
        checks,
        toolStatus
      };
    }

    return {
      status: 'pass',
      summary: '普通对话测试通过：接口返回了有效最终回复。',
      checks,
      toolStatus
    };
  }

  function buildEventLogEntry(event, data, now = new Date()) {
    const type = String(event || 'message');
    const timestamp = formatTime(now);

    if (type === 'tool_result') {
      const title = data?.parsedData?.title || '未命名结果';
      const toolStatus = data?.toolStatus?.status || 'unknown';

      return {
        type,
        timestamp,
        summary: `工具返回：${title}，状态 ${toolStatus}`,
        payload: data || {}
      };
    }

    if (type === 'progress') {
      return {
        type,
        timestamp,
        summary: `进度：${String(data?.message || data?.stage || '处理中')}`,
        payload: data || {}
      };
    }

    if (type === 'done') {
      return {
        type,
        timestamp,
        summary: `完成：${String(data?.reply || '').trim() ? '已生成最终回复' : '未生成最终回复'}`,
        payload: data || {}
      };
    }

    if (type === 'error') {
      return {
        type,
        timestamp,
        summary: `错误：${String(data?.error || '未知错误')}`,
        payload: data || {}
      };
    }

    if (type === 'session') {
      return {
        type,
        timestamp,
        summary: `会话：${String(data?.sessionId || '未提供')}`,
        payload: data || {}
      };
    }

    return {
      type,
      timestamp,
      summary: `${type}：${summarizePayload(data)}`,
      payload: data || {}
    };
  }

  function formatTime(now) {
    const date = now instanceof Date ? now : new Date(now);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  function summarizePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return '空';
    }

    const text = JSON.stringify(payload);
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  }

  const chatDiagnostics = {
    summarizeRunResult,
    buildEventLogEntry
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = chatDiagnostics;
  }

  globalScope.ChatDiagnostics = chatDiagnostics;
})(typeof window !== 'undefined' ? window : globalThis);
