const { normalizeAssistantReply, splitStreamingAssistantReply } = require('./messageNormalizer');

/**
 * StreamEventAdapter 用于把 runtime / provider 层事件转换为上层更稳定的流式事件契约。
 *
 * 主要职责：
 * 1. 接收底层运行时产生的原始事件。
 * 2. 维护当前累计的内容、thinking、reply 状态。
 * 3. 将 `content_delta` 拆解为 `thinking_delta` 与 `reply_delta`。
 * 4. 统一输出 `progress`、`tool_result`、`thinking_delta`、`reply_delta` 等事件。
 * 5. 在流式结束时对最终结果做一次标准化收口。
 */
class StreamEventAdapter {
  /**
   * 创建流式事件适配器。
   *
   * @param {{ emit?: Function, buildToolStatus?: Function }} [options]
   */
  constructor({ emit, buildToolStatus } = {}) {
    /**
     * emit:
     * - 对外派发事件的函数。
     * - 如果调用方未传入，则退化为空函数。
     */
    this.emit = typeof emit === 'function' ? emit : () => {};

    /**
     * buildToolStatus:
     * - 根据 parsedData 生成工具状态摘要的函数。
     * - 若未提供，则默认返回 null。
     */
    this.buildToolStatus = typeof buildToolStatus === 'function'
      ? buildToolStatus
      : () => null;

    /**
     * content:
     * - 当前累计收到的完整原始输出文本。
     */
    this.content = '';

    /**
     * thinking:
     * - 已经累计识别出的 thinking 内容。
     */
    this.thinking = '';

    /**
     * reply:
     * - 已经累计识别出的最终回复内容。
     */
    this.reply = '';
  }

  /**
   * 消费 runtime / 模型事件并映射为 SSE 契约事件。
   *
   * @param {{ type?: string, delta?: string, stage?: string, message?: string, parsedData?: object|null }} event runtime 事件
   */
  consume(event) {
    /**
     * 过滤非法事件，保证后续逻辑只处理对象类型。
     */
    if (!event || typeof event !== 'object') {
      return;
    }

    /**
     * 处理进度事件。
     *
     * `this.emit('progress', ...)` 的作用：
     * - 把底层进度信息以统一事件名转发给上层。
     */
    if (event.type === 'progress') {
      this.emit('progress', {
        stage: event.stage,
        message: event.message
      });
      return;
    }

    /**
     * 处理工具结果事件。
     *
     * `this.buildToolStatus(parsedData)` 的作用：
     * - 如果底层事件没有显式携带 toolStatus，则基于 parsedData 动态生成。
     */
    if (event.type === 'tool_result') {
      const parsedData = event.parsedData || null;
      const toolStatus = event.toolStatus || this.buildToolStatus(parsedData);
      this.emit('tool_result', {
        parsedData,
        toolStatus
      });
      return;
    }

    /**
     * 非文本增量事件直接忽略。
     */
    if (event.type !== 'content_delta' || !event.delta) {
      return;
    }

    /**
     * 累积原始文本内容。
     */
    this.content += event.delta;

    /**
     * 基于当前累计内容重新拆分 thinking 与 reply。
     *
     * `splitStreamingAssistantReply(this.content)` 的作用：
     * - 兼容流式增量场景下的 think/reply 边界识别。
     */
    const normalized = splitStreamingAssistantReply(this.content);
    const nextThinking = normalized.thinking;
    const nextReply = normalized.reply;

    /**
     * 差量内容。
     *
     * 作用：
     * - 只把本轮新增部分发出去，避免上层重复渲染整段文本。
     */
    const thinkingDelta = nextThinking.slice(this.thinking.length);
    const replyDelta = nextReply.slice(this.reply.length);

    /**
     * thinking 增量事件。
     */
    if (thinkingDelta) {
      this.thinking = nextThinking;
      this.emit('thinking_delta', { delta: thinkingDelta });
    } else {
      this.thinking = nextThinking;
    }

    /**
     * reply 增量事件。
     *
     * `this.reply ? replyDelta : replyDelta.replace(/^\s+/, '')` 的作用：
     * - 如果这是 reply 的首个片段，则去掉前导空白，避免首帧出现多余空格。
     */
    if (replyDelta) {
      const emittedReplyDelta = this.reply ? replyDelta : replyDelta.replace(/^\s+/, '');
      this.reply = nextReply;

      if (emittedReplyDelta) {
        this.emit('reply_delta', { delta: emittedReplyDelta });
      }
      return;
    }

    this.reply = nextReply;
  }

  /**
   * 在流式结束后做最终规范化。
   *
   * @param {object|null|{ parsedData?: object|null, content?: string }} input 抖音解析结果或包含解析结果/内容的对象
   * @returns {{ thinking: string, reply: string }}
   */
  finalize(input) {
    /**
     * 兼容两种调用方式：
     * - 直接传 parsedData。
     * - 传 `{ parsedData, content }` 对象。
     */
    const normalizedInput = input && typeof input === 'object' && !Array.isArray(input)
      ? input
      : { parsedData: input };
    const parsedData = normalizedInput.parsedData || null;

    /**
     * content:
     * - 调用方额外传入的完整内容。
     * - 当适配器自身尚未累计到内容时可作为兜底来源。
     */
    const content = typeof normalizedInput.content === 'string'
      ? normalizedInput.content
      : '';

    /**
     * 如果流式过程中没有累计到内容，但 finalize 时有完整内容，则补写进去。
     */
    if (!this.content && content) {
      this.content = content;
    }

    /**
     * `normalizeAssistantReply(...)` 的作用：
     * - 对最终完整内容做一次收口清洗与兜底处理。
     */
    const result = normalizeAssistantReply(this.content, parsedData);
    this.thinking = result.thinking;
    this.reply = result.reply;
    return result;
  }
}

module.exports = StreamEventAdapter;
