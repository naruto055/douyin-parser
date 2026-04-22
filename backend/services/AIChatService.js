const crypto = require('crypto');

const config = require('../config');
const { extractUrlFromText } = require('../utils/douyinParser');
const LLMClientFactory = require('./llm/LLMClientFactory');
const parseDouyinVideoTool = require('./tools/parseDouyinVideoTool');

const sessions = new Map();

const SYSTEM_PROMPT = [
  '你是抖音解析助手。',
  '你的职责是帮助用户解析抖音分享链接，并根据工具返回的结果进行说明。',
  '你不能臆造视频内容、剧情、台词、总结或音频地址。',
  '如果没有工具结果，只能基于用户输入进行有限说明，并建议用户提供有效抖音链接。',
  '如果 audioReady 为 false，必须明确说明当前没有可直接使用的音频直链，只能提示后续可以提取音频。',
  '回答使用简体中文，简洁、专业。'
].join(' ');

class AIChatService {
  /**
   * 处理非流式对话请求，必要时调用抖音解析工具补充上下文。
   *
   * @param {string} message 用户输入消息
   * @param {string} [sessionId] 会话 ID
   * @returns {Promise<{thinking: string, reply: string, sessionId: string, parsedData: object|null, toolStatus: object|null}>}
   */
  static async chat(message, sessionId) {
    // 先校验 AI 能力开关和用户输入，避免无效请求进入后续流程。
    this._assertChatRequest(message);

    // 创建当前配置对应的模型客户端。
    const provider = LLMClientFactory.create();
    // 统一整理会话上下文，得到会话 ID、历史消息和当前用户消息对象。
    const { resolvedSessionId, history, userMessage } = this._createChatContext(message, sessionId);

    let parsedData = null;
    let toolStatus = null;
    let thinking = '';
    let reply = '';

    console.log(`[AI] provider=${provider.getName()} model=${config.ai.model} session=${resolvedSessionId}`);

    try {
      // 首次请求模型，让模型决定是直接回答还是发起工具调用。
      const initialResponse = await provider.generate({
        messages: this._buildModelMessages(history, userMessage),
        tools: [parseDouyinVideoTool.definition]
      });

      console.log(`[AI] initial toolCalls=${initialResponse.toolCalls.length}`);

      if (initialResponse.toolCalls.length > 0) {
        // 模型主动选择工具时，执行工具并将结果回填给模型生成最终答复。
        const toolContext = await this._executeToolCalls(initialResponse.toolCalls);
        parsedData = toolContext.parsedData;
        // 根据工具结果补充前端可感知的状态信息，例如是否命中了可疑占位链接。
        toolStatus = this._buildToolStatus(parsedData);

        // 把工具执行结果追加回消息列表，要求模型基于真实解析结果生成最终答复。
        const finalResponse = await provider.generate({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history,
            userMessage,
            {
              role: 'assistant',
              content: initialResponse.content || '',
              tool_calls: toolContext.assistantToolCalls
            },
            ...toolContext.toolMessages
          ]
        });

        // 标准化模型输出，拆分思考内容与用户可见回复。
        ({ thinking, reply } = this._normalizeAssistantReply(finalResponse.content, parsedData));
      } else {
        // 某些模型可能未触发工具调用，这里在检测到抖音链接时走兜底解析路径。
        // 从用户文本中尝试提取抖音链接，决定是否直接执行本地解析。
        const extractedUrl = extractUrlFromText(userMessage.content);
        if (extractedUrl) {
          console.log('[AI] fallback parsing path activated');
          parsedData = await parseDouyinVideoTool.execute({ url: extractedUrl });
          // 将本地解析结果映射为统一状态结构，便于上层消费。
          toolStatus = this._buildToolStatus(parsedData);

          // 在已有解析结果的前提下，再次请求模型生成更准确的说明性回复。
          const fallbackResponse = await provider.generate({
            messages: this._buildFallbackMessages(history, userMessage, parsedData)
          });

          // 统一清洗模型输出格式，保证返回结构稳定。
          ({ thinking, reply } = this._normalizeAssistantReply(fallbackResponse.content, parsedData));
        } else {
          // 没有链接时只能基于模型原始输出生成回复。
          ({ thinking, reply } = this._normalizeAssistantReply(initialResponse.content, null));
        }
      }
    } catch (error) {
      if (error.name === 'ZodError') {
        const validationError = new Error('Invalid tool arguments');
        validationError.statusCode = 400;
        throw validationError;
      }
      throw error;
    }

    // 将本轮对话写入会话历史，供后续多轮对话继续使用。
    this._saveSession(resolvedSessionId, userMessage, reply);

    return {
      thinking,
      reply,
      sessionId: resolvedSessionId,
      parsedData,
      toolStatus
    };
  }

  /**
   * 处理流式对话请求，并通过事件回调持续推送阶段性结果。
   *
   * @param {string} message 用户输入消息
   * @param {string} [sessionId] 会话 ID
   * @param {{ onEvent?: Function }} [options] 流式事件处理配置
   * @returns {Promise<{thinking: string, reply: string, sessionId: string, parsedData: object|null, toolStatus: object|null}>}
   */
  static async chatStream(message, sessionId, { onEvent } = {}) {
    // 与非流式入口保持一致，先做请求合法性校验。
    this._assertChatRequest(message);

    // 创建流式输出所使用的模型客户端。
    const provider = LLMClientFactory.create();
    // 初始化流式会话上下文。
    const { resolvedSessionId, history, userMessage } = this._createChatContext(message, sessionId);
    // 兜底空事件处理器，避免每次触发事件前都判断回调是否存在。
    const emit = typeof onEvent === 'function' ? onEvent : () => {};

    let parsedData = null;
    let toolStatus = null;
    let content = '';
    let thinking = '';
    let reply = '';

    console.log(`[AI] provider=${provider.getName()} model=${config.ai.model} session=${resolvedSessionId} stream=true`);

    emit('session', { sessionId: resolvedSessionId });
    emit('progress', { stage: 'model_start', message: 'AI 正在分析输入' });

    try {
      // 先尝试从输入中抽取抖音链接，流式模式下优先做本地解析。
      const extractedUrl = extractUrlFromText(userMessage.content);
      if (extractedUrl) {
        // 流式场景优先执行一次本地兜底解析，尽早把结构化结果推给前端。
        console.log('[AI] stream fallback parsing path activated');
        parsedData = await parseDouyinVideoTool.execute({ url: extractedUrl });
        // 构建标准化工具状态，并通过事件通知前端。
        toolStatus = this._buildToolStatus(parsedData);
        emit('tool_result', { parsedData, toolStatus });
      }

      // 如果已经拿到解析结果，则直接走兜底消息；否则交给模型自行决定是否调用工具。
      const messages = parsedData
        ? this._buildFallbackMessages(history, userMessage, parsedData)
        : this._buildModelMessages(history, userMessage);

      // 按增量方式消费模型输出流，并实时拆分为 thinking/reply 两部分。
      for await (const chunk of provider.streamGenerate({
        messages,
        tools: parsedData ? [] : [parseDouyinVideoTool.definition]
      })) {
        if (chunk.type !== 'content_delta' || !chunk.delta) {
          continue;
        }

        content += chunk.delta;

        // 流式输出过程中持续拆分 thinking 与 reply，确保前端可以增量渲染。
        const normalized = this._splitStreamingAssistantReply(content);
        const nextThinking = normalized.thinking;
        const nextReply = normalized.reply;
        const thinkingDelta = nextThinking.slice(thinking.length);
        const replyDelta = nextReply.slice(reply.length);

        if (thinkingDelta) {
          thinking = nextThinking;
          // 持续推送新增的思考片段，便于前端独立展示推理过程。
          emit('thinking_delta', { delta: thinkingDelta });
        }

        if (replyDelta) {
          const emittedReplyDelta = reply ? replyDelta : replyDelta.replace(/^\s+/, '');
          reply = nextReply;

          if (emittedReplyDelta) {
            // 回复正文按增量输出，首段会额外去掉前导空白。
            emit('reply_delta', { delta: emittedReplyDelta });
          }
        }
      }
    } catch (error) {
      if (error.name === 'ZodError') {
        const validationError = new Error('Invalid tool arguments');
        validationError.statusCode = 400;
        throw validationError;
      }
      throw error;
    }

    // 流结束后再做一次完整规范化，确保最终结果与非流式返回结构一致。
    const normalizedResult = this._normalizeAssistantReply(content, parsedData);
    thinking = normalizedResult.thinking;
    reply = normalizedResult.reply;

    // 保存本轮对话上下文，支持后续继续追问。
    this._saveSession(resolvedSessionId, userMessage, reply);

    const result = {
      thinking,
      reply,
      sessionId: resolvedSessionId,
      parsedData,
      toolStatus
    };

    // 通知调用方流式输出已完成，并返回最终聚合结果。
    emit('done', result);
    return result;
  }

  /**
   * 校验 AI 对话请求的前置条件。
   *
   * @param {string} message 用户输入消息
   */
  static _assertChatRequest(message) {
    if (!config.ai.enabled) {
      const error = new Error('AI chat is disabled');
      error.statusCode = 403;
      throw error;
    }

    if (!message || !String(message).trim()) {
      const error = new Error('message is required');
      error.statusCode = 400;
      throw error;
    }
  }

  /**
   * 构建对话上下文，包括会话 ID、历史消息和当前用户消息。
   *
   * @param {string} message 用户输入消息
   * @param {string} [sessionId] 会话 ID
   * @returns {{ resolvedSessionId: string, history: Array, userMessage: { role: string, content: string } }}
   */
  static _createChatContext(message, sessionId) {
    // 外部未传 sessionId 时自动创建，保证每轮对话都可归属到某个会话。
    const resolvedSessionId = sessionId || this._createSessionId();
    // 读取该会话的历史消息，供模型维持上下文连续性。
    const history = this._getSessionMessages(resolvedSessionId);
    // 将用户输入标准化为模型所需的消息结构。
    const userMessage = { role: 'user', content: String(message).trim() };

    return {
      resolvedSessionId,
      history,
      userMessage
    };
  }

  /**
   * 构建基础模型消息列表。
   *
   * @param {Array} history 历史消息
   * @param {{ role: string, content: string }} userMessage 当前用户消息
   * @returns {Array}
   */
  static _buildModelMessages(history, userMessage) {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      userMessage
    ];
  }

  /**
   * 构建兜底解析场景下的模型消息列表。
   *
   * @param {Array} history 历史消息
   * @param {{ role: string, content: string }} userMessage 当前用户消息
   * @param {object} parsedData 抖音解析结果
   * @returns {Array}
   */
  static _buildFallbackMessages(history, userMessage, parsedData) {
    return [
      ...this._buildModelMessages(history, userMessage),
      {
        role: 'system',
        content: `以下是工具 parse_douyin_video 的执行结果，请基于它回答用户：${JSON.stringify(parsedData)}`
      }
    ];
  }

  /**
   * 根据解析结果生成工具执行状态。
   *
   * @param {object|null} parsedData 抖音解析结果
   * @returns {{ status: string, warnings: string[] }|null}
   */
  static _buildToolStatus(parsedData) {
    if (!parsedData) {
      return null;
    }

    const warnings = [];
    // 统一清洗分享链接字段，避免空值和前后空格影响判断。
    const shareUrl = String(parsedData.shareUrl || '').trim();

    if (this._isPlaceholderShareUrl(shareUrl)) {
      warnings.push('placeholder_share_url');
    }

    return {
      status: warnings.length > 0 ? 'suspect' : 'resolved',
      warnings
    };
  }

  /**
   * 判断分享链接是否仍为占位值。
   *
   * @param {string} url 分享链接
   * @returns {boolean}
   */
  static _isPlaceholderShareUrl(url) {
    if (!url) {
      return false;
    }

    return /^https?:\/\/v\.douyin\.com\/x{5,}\/?$/i.test(url);
  }

  /**
   * 生成新的会话 ID。
   *
   * @returns {string}
   */
  static _createSessionId() {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * 获取指定会话的历史消息。
   *
   * @param {string} sessionId 会话 ID
   * @returns {Array}
   */
  static _getSessionMessages(sessionId) {
    return sessions.get(sessionId) || [];
  }

  /**
   * 保存当前轮次的用户消息和助手回复，并按配置裁剪历史长度。
   *
   * @param {string} sessionId 会话 ID
   * @param {{ role: string, content: string }} userMessage 当前用户消息
   * @param {string} reply 助手回复
   */
  static _saveSession(sessionId, userMessage, reply) {
    // 先取出现有历史，再拼接本轮用户消息和助手回复。
    const history = this._getSessionMessages(sessionId);
    const nextHistory = [
      ...history,
      userMessage,
      { role: 'assistant', content: reply }
    ].slice(-config.ai.sessionLimit * 2);

    // 按配置限制历史轮次，避免上下文无限增长。
    sessions.set(sessionId, nextHistory);
  }

  /**
   * 规范化模型返回内容，提取 thinking 和最终 reply。
   *
   * @param {string} content 模型原始输出
   * @param {object|null} parsedData 抖音解析结果
   * @returns {{ thinking: string, reply: string }}
   */
  static _normalizeAssistantReply(content, parsedData) {
    // 先清除模型供应商内部工具协议标记，再拆分思考和正文。
    const sanitizedContent = this._stripVendorToolCallMarkup(content);
    const { thinking, reply } = this._splitThinkingAndReply(sanitizedContent);

    return {
      thinking,
      reply: reply || this._buildFallbackReply(parsedData)
    };
  }

  /**
   * 在流式输出过程中拆分思考内容与最终回复。
   *
   * @param {string} content 当前累计输出内容
   * @returns {{ thinking: string, reply: string }}
   */
  static _splitStreamingAssistantReply(content) {
    // 流式场景允许尾部存在半截标签，避免中间态污染展示内容。
    const normalizedContent = this._stripVendorToolCallMarkup(content, { allowPartialTail: true });
    const openTag = '<think>';
    const closeTag = '</think>';
    const replyParts = [];
    const thinkingParts = [];
    let cursor = 0;

    while (cursor < normalizedContent.length) {
      const openIndex = normalizedContent.indexOf(openTag, cursor);
      if (openIndex === -1) {
        const tail = normalizedContent.slice(cursor);
        // 没有完整 think 标签时，再判断尾部是否残留半截标签。
        const partialTagIndex = this._findPartialThinkTagIndex(tail);
        replyParts.push(partialTagIndex === -1 ? tail : tail.slice(0, partialTagIndex));
        break;
      }

      replyParts.push(normalizedContent.slice(cursor, openIndex));

      const thinkStart = openIndex + openTag.length;
      const closeIndex = normalizedContent.indexOf(closeTag, thinkStart);
      if (closeIndex === -1) {
        // 已进入 think 段但尚未闭合时，先把剩余内容都视为 thinking。
        thinkingParts.push(normalizedContent.slice(thinkStart));
        break;
      }

      thinkingParts.push(normalizedContent.slice(thinkStart, closeIndex));
      cursor = closeIndex + closeTag.length;
    }

    return {
      thinking: thinkingParts.join(''),
      reply: replyParts.join('')
    };
  }

  /**
   * 定位不完整 think 标签的起始位置，避免流式场景误输出半截标签。
   *
   * @param {string} content 待检查内容
   * @returns {number}
   */
  static _findPartialThinkTagIndex(content) {
    const partialTokens = ['<think', '<thin', '<thi', '<th', '<t', '<'];

    for (const token of partialTokens) {
      if (content.endsWith(token)) {
        return content.length - token.length;
      }
    }

    return -1;
  }

  /**
   * 移除供应商注入的工具调用标记，避免其污染最终展示文本。
   *
   * @param {string} content 模型原始输出
   * @param {{ allowPartialTail?: boolean }} [options] 是否允许处理尾部不完整标签
   * @returns {string}
   */
  static _stripVendorToolCallMarkup(content, { allowPartialTail = false } = {}) {
    const normalizedContent = typeof content === 'string' ? content : '';
    const openTag = '<minimax:tool_call>';
    const closeTag = '</minimax:tool_call>';
    let sanitized = '';
    let cursor = 0;

    while (cursor < normalizedContent.length) {
      const openIndex = normalizedContent.indexOf(openTag, cursor);
      if (openIndex === -1) {
        const tail = normalizedContent.slice(cursor);
        if (allowPartialTail) {
          const partialOpenIndex = this._findPartialTokenIndex(tail, openTag);
          sanitized += partialOpenIndex === -1 ? tail : tail.slice(0, partialOpenIndex);
        } else {
          sanitized += tail;
        }
        break;
      }

      sanitized += normalizedContent.slice(cursor, openIndex);

      const closeIndex = normalizedContent.indexOf(closeTag, openIndex + openTag.length);
      if (closeIndex === -1) {
        // 不完整的工具标签直接截断，避免把供应商内部协议泄露给用户。
        break;
      }

      cursor = closeIndex + closeTag.length;
    }

    return sanitized;
  }

  /**
   * 定位任意 token 的部分匹配起点，用于处理流式尾部半截标签。
   *
   * @param {string} content 待检查内容
   * @param {string} token 完整 token
   * @returns {number}
   */
  static _findPartialTokenIndex(content, token) {
    for (let length = token.length - 1; length > 0; length -= 1) {
      const partial = token.slice(0, length);
      if (content.endsWith(partial)) {
        return content.length - partial.length;
      }
    }

    return -1;
  }

  /**
   * 从完整输出中拆分 think 内容与最终回复正文。
   *
   * @param {string} content 模型输出
   * @returns {{ thinking: string, reply: string }}
   */
  static _splitThinkingAndReply(content) {
    const normalizedContent = typeof content === 'string' ? content.trim() : '';
    // 提取完整的 think 标签内容，未命中时整段都视为回复正文。
    const thinkMatch = normalizedContent.match(/<think>([\s\S]*?)<\/think>/i);

    if (!thinkMatch) {
      return {
        thinking: '',
        reply: normalizedContent
      };
    }

    const thinking = thinkMatch[1].trim();
    const reply = `${normalizedContent.slice(0, thinkMatch.index)}${normalizedContent.slice(thinkMatch.index + thinkMatch[0].length)}`.trim();

    return {
      thinking,
      reply
    };
  }

  /**
   * 执行模型返回的工具调用，并构造二次对话所需的工具消息。
   *
   * @param {Array} toolCalls 模型返回的工具调用列表
   * @returns {Promise<{ parsedData: object|null, assistantToolCalls: Array, toolMessages: Array }>}
   */
  static async _executeToolCalls(toolCalls) {
    const assistantToolCalls = [];
    const toolMessages = [];
    let parsedData = null;

    for (const toolCall of toolCalls) {
      if (toolCall.name !== parseDouyinVideoTool.name) {
        continue;
      }

      // 仅执行当前服务显式支持的工具，避免处理未知工具调用。
      const args = JSON.parse(toolCall.arguments || '{}');
      // 执行抖音解析工具，拿到结构化解析结果。
      parsedData = await parseDouyinVideoTool.execute(args);

      // 按 OpenAI 风格回填 assistant 的 tool_calls，供下一次模型请求关联上下文。
      assistantToolCalls.push({
        id: toolCall.id,
        type: 'function',
        function: {
          name: parseDouyinVideoTool.name,
          arguments: JSON.stringify(args)
        }
      });

      // 将工具执行结果包装成 tool 消息，参与后续最终回答生成。
      toolMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(parsedData)
      });
    }

    return {
      parsedData,
      assistantToolCalls,
      toolMessages
    };
  }

  /**
   * 当模型未返回可用答复时，根据解析结果生成兜底文案。
   *
   * @param {object|null} parsedData 抖音解析结果
   * @returns {string}
   */
  static _buildFallbackReply(parsedData) {
    if (!parsedData) {
      return '请发送抖音分享链接或包含链接的分享文案，我可以帮你解析。';
    }

    const audioText = parsedData.audioReady
      ? '当前可直接获取音频。'
      : '当前没有可直接使用的音频直链，但仍可尝试提取音频。';

    return `解析成功，标题：${parsedData.title || '未知'}，作者：${parsedData.author || '未知'}。${audioText}`;
  }
}

module.exports = AIChatService;
