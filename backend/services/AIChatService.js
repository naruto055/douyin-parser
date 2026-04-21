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
  static async chat(message, sessionId) {
    this._assertChatRequest(message);

    const provider = LLMClientFactory.create();
    const { resolvedSessionId, history, userMessage } = this._createChatContext(message, sessionId);

    let parsedData = null;
    let toolStatus = null;
    let thinking = '';
    let reply = '';

    console.log(`[AI] provider=${provider.getName()} model=${config.ai.model} session=${resolvedSessionId}`);

    try {
      const initialResponse = await provider.generate({
        messages: this._buildModelMessages(history, userMessage),
        tools: [parseDouyinVideoTool.definition]
      });

      console.log(`[AI] initial toolCalls=${initialResponse.toolCalls.length}`);

      if (initialResponse.toolCalls.length > 0) {
        const toolContext = await this._executeToolCalls(initialResponse.toolCalls);
        parsedData = toolContext.parsedData;
        toolStatus = this._buildToolStatus(parsedData);

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

        ({ thinking, reply } = this._normalizeAssistantReply(finalResponse.content, parsedData));
      } else {
        const extractedUrl = extractUrlFromText(userMessage.content);
        if (extractedUrl) {
          console.log('[AI] fallback parsing path activated');
          parsedData = await parseDouyinVideoTool.execute({ url: extractedUrl });
          toolStatus = this._buildToolStatus(parsedData);

          const fallbackResponse = await provider.generate({
            messages: this._buildFallbackMessages(history, userMessage, parsedData)
          });

          ({ thinking, reply } = this._normalizeAssistantReply(fallbackResponse.content, parsedData));
        } else {
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

    this._saveSession(resolvedSessionId, userMessage, reply);

    return {
      thinking,
      reply,
      sessionId: resolvedSessionId,
      parsedData,
      toolStatus
    };
  }

  static async chatStream(message, sessionId, { onEvent } = {}) {
    this._assertChatRequest(message);

    const provider = LLMClientFactory.create();
    const { resolvedSessionId, history, userMessage } = this._createChatContext(message, sessionId);
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
      const extractedUrl = extractUrlFromText(userMessage.content);
      if (extractedUrl) {
        console.log('[AI] stream fallback parsing path activated');
        parsedData = await parseDouyinVideoTool.execute({ url: extractedUrl });
        toolStatus = this._buildToolStatus(parsedData);
        emit('tool_result', { parsedData, toolStatus });
      }

      const messages = parsedData
        ? this._buildFallbackMessages(history, userMessage, parsedData)
        : this._buildModelMessages(history, userMessage);

      for await (const chunk of provider.streamGenerate({
        messages,
        tools: parsedData ? [] : [parseDouyinVideoTool.definition]
      })) {
        if (chunk.type !== 'content_delta' || !chunk.delta) {
          continue;
        }

        content += chunk.delta;

        const normalized = this._splitStreamingAssistantReply(content);
        const nextThinking = normalized.thinking;
        const nextReply = normalized.reply;
        const thinkingDelta = nextThinking.slice(thinking.length);
        const replyDelta = nextReply.slice(reply.length);

        if (thinkingDelta) {
          thinking = nextThinking;
          emit('thinking_delta', { delta: thinkingDelta });
        }

        if (replyDelta) {
          const emittedReplyDelta = reply ? replyDelta : replyDelta.replace(/^\s+/, '');
          reply = nextReply;

          if (emittedReplyDelta) {
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

    const normalizedResult = this._normalizeAssistantReply(content, parsedData);
    thinking = normalizedResult.thinking;
    reply = normalizedResult.reply;

    this._saveSession(resolvedSessionId, userMessage, reply);

    const result = {
      thinking,
      reply,
      sessionId: resolvedSessionId,
      parsedData,
      toolStatus
    };

    emit('done', result);
    return result;
  }

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

  static _createChatContext(message, sessionId) {
    const resolvedSessionId = sessionId || this._createSessionId();
    const history = this._getSessionMessages(resolvedSessionId);
    const userMessage = { role: 'user', content: String(message).trim() };

    return {
      resolvedSessionId,
      history,
      userMessage
    };
  }

  static _buildModelMessages(history, userMessage) {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      userMessage
    ];
  }

  static _buildFallbackMessages(history, userMessage, parsedData) {
    return [
      ...this._buildModelMessages(history, userMessage),
      {
        role: 'system',
        content: `以下是工具 parse_douyin_video 的执行结果，请基于它回答用户：${JSON.stringify(parsedData)}`
      }
    ];
  }

  static _buildToolStatus(parsedData) {
    if (!parsedData) {
      return null;
    }

    const warnings = [];
    const shareUrl = String(parsedData.shareUrl || '').trim();

    if (this._isPlaceholderShareUrl(shareUrl)) {
      warnings.push('placeholder_share_url');
    }

    return {
      status: warnings.length > 0 ? 'suspect' : 'resolved',
      warnings
    };
  }

  static _isPlaceholderShareUrl(url) {
    if (!url) {
      return false;
    }

    return /^https?:\/\/v\.douyin\.com\/x{5,}\/?$/i.test(url);
  }

  static _createSessionId() {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
  }

  static _getSessionMessages(sessionId) {
    return sessions.get(sessionId) || [];
  }

  static _saveSession(sessionId, userMessage, reply) {
    const history = this._getSessionMessages(sessionId);
    const nextHistory = [
      ...history,
      userMessage,
      { role: 'assistant', content: reply }
    ].slice(-config.ai.sessionLimit * 2);

    sessions.set(sessionId, nextHistory);
  }

  static _normalizeAssistantReply(content, parsedData) {
    const sanitizedContent = this._stripVendorToolCallMarkup(content);
    const { thinking, reply } = this._splitThinkingAndReply(sanitizedContent);

    return {
      thinking,
      reply: reply || this._buildFallbackReply(parsedData)
    };
  }

  static _splitStreamingAssistantReply(content) {
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
        const partialTagIndex = this._findPartialThinkTagIndex(tail);
        replyParts.push(partialTagIndex === -1 ? tail : tail.slice(0, partialTagIndex));
        break;
      }

      replyParts.push(normalizedContent.slice(cursor, openIndex));

      const thinkStart = openIndex + openTag.length;
      const closeIndex = normalizedContent.indexOf(closeTag, thinkStart);
      if (closeIndex === -1) {
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

  static _findPartialThinkTagIndex(content) {
    const partialTokens = ['<think', '<thin', '<thi', '<th', '<t', '<'];

    for (const token of partialTokens) {
      if (content.endsWith(token)) {
        return content.length - token.length;
      }
    }

    return -1;
  }

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
        break;
      }

      cursor = closeIndex + closeTag.length;
    }

    return sanitized;
  }

  static _findPartialTokenIndex(content, token) {
    for (let length = token.length - 1; length > 0; length -= 1) {
      const partial = token.slice(0, length);
      if (content.endsWith(partial)) {
        return content.length - partial.length;
      }
    }

    return -1;
  }

  static _splitThinkingAndReply(content) {
    const normalizedContent = typeof content === 'string' ? content.trim() : '';
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

  static async _executeToolCalls(toolCalls) {
    const assistantToolCalls = [];
    const toolMessages = [];
    let parsedData = null;

    for (const toolCall of toolCalls) {
      if (toolCall.name !== parseDouyinVideoTool.name) {
        continue;
      }

      const args = JSON.parse(toolCall.arguments || '{}');
      parsedData = await parseDouyinVideoTool.execute(args);

      assistantToolCalls.push({
        id: toolCall.id,
        type: 'function',
        function: {
          name: parseDouyinVideoTool.name,
          arguments: JSON.stringify(args)
        }
      });

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
