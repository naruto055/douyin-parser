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

    const provider = LLMClientFactory.create();
    const resolvedSessionId = sessionId || this._createSessionId();
    const history = this._getSessionMessages(resolvedSessionId);
    const userMessage = { role: 'user', content: String(message).trim() };

    let parsedData = null;
    let thinking = '';
    let reply = '';

    console.log(`[AI] provider=${provider.getName()} model=${config.ai.model} session=${resolvedSessionId}`);

    try {
      const initialResponse = await provider.generate({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history,
          userMessage
        ],
        tools: [parseDouyinVideoTool.definition]
      });

      console.log(`[AI] initial toolCalls=${initialResponse.toolCalls.length}`);

      if (initialResponse.toolCalls.length > 0) {
        const toolContext = await this._executeToolCalls(initialResponse.toolCalls);
        parsedData = toolContext.parsedData;

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

          const fallbackResponse = await provider.generate({
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              ...history,
              userMessage,
              {
                role: 'system',
                content: `以下是工具 parse_douyin_video 的执行结果，请基于它回答用户：${JSON.stringify(parsedData)}`
              }
            ]
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
      parsedData
    };
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
    const { thinking, reply } = this._splitThinkingAndReply(content);

    return {
      thinking,
      reply: reply || this._buildFallbackReply(parsedData)
    };
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
