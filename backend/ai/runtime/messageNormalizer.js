/**
 * messageNormalizer 负责对模型输出做清洗、拆分和兜底处理。
 *
 * 主要职责：
 * 1. 移除模型供应商注入的工具调用标记。
 * 2. 从输出文本中拆分 thinking 内容和最终 reply。
 * 3. 兼容流式场景下“不完整标签”的增量解析。
 * 4. 当模型没有给出可用答复时，基于解析结果生成兜底文案。
 */

/**
 * 规范化模型输出，提取 thinking 和最终 reply。
 *
 * @param {string} content 模型原始输出
 * @param {object|null} parsedData 抖音解析结果
 * @returns {{ thinking: string, reply: string }}
 */
function normalizeAssistantReply(content, parsedData) {
  /**
   * 清洗掉供应商注入的工具调用标记后的文本。
   *
   * `stripVendorToolCallMarkup(content)` 的作用：
   * - 移除模型输出中夹带的 `<minimax:tool_call>...</minimax:tool_call>` 片段。
   * - 避免这些底层协议内容污染最终展示给用户的文本。
   */
  const sanitizedContent = stripVendorToolCallMarkup(content);

  /**
   * 拆分后的 thinking 与 reply。
   *
   * `splitThinkingAndReply(...)` 的作用：
   * - 从清洗后的完整文本中提取思考内容和最终回复正文。
   */
  const { thinking, reply } = splitThinkingAndReply(sanitizedContent);

  return {
    thinking,
    /**
     * 如果模型没有给出最终 reply，则退化为兜底文案。
     *
     * `buildFallbackReply(parsedData)` 的作用：
     * - 基于工具解析结果生成一个最少可用的自然语言回复。
     */
    reply: reply || buildFallbackReply(parsedData)
  };
}

/**
 * 在流式输出过程中拆分思考内容与最终回复。
 *
 * @param {string} content 当前累计输出内容
 * @returns {{ thinking: string, reply: string }}
 */
function splitStreamingAssistantReply(content) {
  /**
   * 流式清洗后的文本。
   *
   * `allowPartialTail: true` 的作用：
   * - 允许在流式增量输出中忽略尾部尚未接收完整的标记片段。
   * - 避免半截标签干扰当前轮拆分结果。
   */
  const normalizedContent = stripVendorToolCallMarkup(content, { allowPartialTail: true });

  /**
   * think 标签的起止标记。
   *
   * 作用：
   * - 用于识别模型输出中包裹“思考过程”的片段。
   */
  const openTag = '<think>';
  const closeTag = '</think>';

  /**
   * replyParts:
   * - 收集非 think 区域的内容，最终拼成用户可见回复。
   *
   * thinkingParts:
   * - 收集 think 区域内容，最终拼成 thinking 文本。
   */
  const replyParts = [];
  const thinkingParts = [];

  /**
   * cursor:
   * - 当前扫描位置指针。
   * - 用于逐段遍历整个输出字符串。
   */
  let cursor = 0;

  while (cursor < normalizedContent.length) {
    /**
     * 查找下一个 `<think>` 起始位置。
     *
     * `indexOf(openTag, cursor)` 的作用：
     * - 从当前游标位置开始搜索下一个思考标签。
     */
    const openIndex = normalizedContent.indexOf(openTag, cursor);
    if (openIndex === -1) {
      /**
       * 如果后续没有完整 `<think>` 标签，则剩余内容默认视为 reply 尾部。
       */
      const tail = normalizedContent.slice(cursor);

      /**
       * `findPartialThinkTagIndex(tail)` 的作用：
       * - 判断尾部是否出现了不完整的 think 标签前缀。
       * - 如果有，则截掉这段不完整前缀，避免错误展示给用户。
       */
      const partialTagIndex = findPartialThinkTagIndex(tail);
      replyParts.push(partialTagIndex === -1 ? tail : tail.slice(0, partialTagIndex));
      break;
    }

    /**
     * 把当前位置到 `<think>` 之前的内容视为 reply 文本。
     */
    replyParts.push(normalizedContent.slice(cursor, openIndex));

    const thinkStart = openIndex + openTag.length;

    /**
     * 查找对应的 `</think>` 结束位置。
     */
    const closeIndex = normalizedContent.indexOf(closeTag, thinkStart);
    if (closeIndex === -1) {
      /**
       * 若没有闭合标签，则把剩余部分视为尚未结束的 thinking 内容。
       */
      thinkingParts.push(normalizedContent.slice(thinkStart));
      break;
    }

    /**
     * 提取完整的 thinking 内容，并把游标推进到闭合标签之后。
     */
    thinkingParts.push(normalizedContent.slice(thinkStart, closeIndex));
    cursor = closeIndex + closeTag.length;
  }

  return {
    thinking: thinkingParts.join(''),
    reply: replyParts.join('')
  };
}

/**
 * 移除供应商注入的工具调用标记。
 *
 * @param {string} content 模型原始输出
 * @param {{ allowPartialTail?: boolean }} [options] 是否允许处理尾部不完整标签
 * @returns {string}
 */
function stripVendorToolCallMarkup(content, { allowPartialTail = false } = {}) {
  /**
   * 标准化后的原始内容。
   *
   * 作用：
   * - 保证后续始终按字符串处理。
   */
  const normalizedContent = typeof content === 'string' ? content : '';

  /**
   * 供应商注入的工具调用标记起止 token。
   */
  const openTag = '<minimax:tool_call>';
  const closeTag = '</minimax:tool_call>';

  /**
   * sanitized:
   * - 清洗后的累计文本结果。
   *
   * cursor:
   * - 当前扫描位置。
   */
  let sanitized = '';
  let cursor = 0;

  while (cursor < normalizedContent.length) {
    /**
     * 查找下一个工具调用开始标记。
     */
    const openIndex = normalizedContent.indexOf(openTag, cursor);
    if (openIndex === -1) {
      const tail = normalizedContent.slice(cursor);

      /**
       * 在流式场景下，尾部可能只到达了部分开始标记。
       *
       * `findPartialTokenIndex(tail, openTag)` 的作用：
       * - 定位尾部是否出现了 openTag 的不完整前缀。
       * - 若存在，则从结果中裁掉这段半截标记。
       */
      if (allowPartialTail) {
        const partialOpenIndex = findPartialTokenIndex(tail, openTag);
        sanitized += partialOpenIndex === -1 ? tail : tail.slice(0, partialOpenIndex);
      } else {
        sanitized += tail;
      }
      break;
    }

    /**
     * 保留工具调用标记之前的普通内容。
     */
    sanitized += normalizedContent.slice(cursor, openIndex);

    /**
     * 查找对应结束标记，若找不到则说明后半段不完整，直接停止。
     */
    const closeIndex = normalizedContent.indexOf(closeTag, openIndex + openTag.length);
    if (closeIndex === -1) {
      break;
    }

    /**
     * 跳过整段工具调用标记，把游标推进到结束标记之后。
     */
    cursor = closeIndex + closeTag.length;
  }

  return sanitized;
}

/**
 * 从完整输出中拆分 think 内容与最终回复正文。
 *
 * @param {string} content 模型输出
 * @returns {{ thinking: string, reply: string }}
 */
function splitThinkingAndReply(content) {
  /**
   * 去除首尾空白后的完整内容。
   */
  const normalizedContent = typeof content === 'string' ? content.trim() : '';

  /**
   * 复用流式拆分逻辑处理完整输出，避免重复实现一套解析规则。
   */
  const splitResult = splitStreamingAssistantReply(normalizedContent);

  /**
   * 再次 trim，避免 thinking/reply 两端残留空白字符。
   */
  const thinking = splitResult.thinking.trim();
  const reply = splitResult.reply.trim();

  return {
    thinking,
    reply
  };
}

/**
 * 当模型未返回可用答复时，根据解析结果生成兜底文案。
 *
 * @param {object|null} parsedData 抖音解析结果
 * @returns {string}
 */
function buildFallbackReply(parsedData) {
  /**
   * 如果没有解析结果，就返回引导用户继续提供抖音链接的默认文案。
   */
  if (!parsedData) {
    return '请发送抖音分享链接或包含链接的分享文案，我可以帮你解析。';
  }

  /**
   * 根据是否已有可用音频直链，动态生成不同提示。
   */
  const audioText = parsedData.audioReady
    ? '当前可直接获取音频。'
    : '当前没有可直接使用的音频直链，但仍可尝试提取音频。';

  /**
   * 拼接解析结果摘要，作为最小可用回复。
   */
  return `解析成功，标题：${parsedData.title || '未知'}，作者：${parsedData.author || '未知'}。${audioText}`;
}

/**
 * 定位不完整 think 标签的起始位置。
 *
 * @param {string} content 待检查内容
 * @returns {number}
 */
function findPartialThinkTagIndex(content) {
  /**
   * think 标签可能出现的所有“尾部不完整前缀”。
   *
   * 作用：
   * - 在流式输出场景下识别半截 `<think>` 标签。
   */
  const partialTokens = ['<think', '<thin', '<thi', '<th', '<t', '<'];

  for (const token of partialTokens) {
    /**
     * `content.endsWith(token)` 的作用：
     * - 判断当前内容尾部是否停在某个不完整标签前缀上。
     */
    if (content.endsWith(token)) {
      return content.length - token.length;
    }
  }

  return -1;
}

/**
 * 定位 token 的部分匹配起点。
 *
 * @param {string} content 待检查内容
 * @param {string} token 完整 token
 * @returns {number}
 */
function findPartialTokenIndex(content, token) {
  /**
   * 从完整 token 长度 - 1 开始倒序尝试匹配尾部前缀。
   *
   * 作用：
   * - 找出内容尾部是否以某个 token 的部分前缀结束。
   */
  for (let length = token.length - 1; length > 0; length -= 1) {
    const partial = token.slice(0, length);
    if (content.endsWith(partial)) {
      return content.length - partial.length;
    }
  }

  return -1;
}

module.exports = {
  normalizeAssistantReply,
  splitStreamingAssistantReply,
  stripVendorToolCallMarkup,
  splitThinkingAndReply,
  buildFallbackReply
};
