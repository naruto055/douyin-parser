const config = require('../config');
const SYSTEM_PROMPT = require('../ai/prompts/systemPrompt');
const AISessionStore = require('../ai/sessions/AISessionStore');
const AIChatAppService = require('../ai/application/AIChatAppService');
const AIStreamAppService = require('../ai/application/AIStreamAppService');
const createChatRuntime = require('../ai/runtime/createChatRuntime');
const {
  normalizeAssistantReply,
  splitStreamingAssistantReply,
  stripVendorToolCallMarkup,
  splitThinkingAndReply,
  buildFallbackReply
} = require('../ai/runtime/messageNormalizer');

const sessionStore = new AISessionStore();

class AIChatService {
  /**
   * 处理非流式对话请求，必要时调用抖音解析工具补充上下文。
   *
   * @param {string} message 用户输入消息
   * @param {string} [sessionId] 会话 ID
   * @returns {Promise<{thinking: string, reply: string, sessionId: string, parsedData: object|null, toolStatus: object|null}>}
   */
  static async chat(message, sessionId) {
    return AIChatAppService.chat(message, sessionId);
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
    return AIStreamAppService.chatStream(message, sessionId, { onEvent });
  }

  /**
   * 校验 AI 对话请求的前置条件。
   *
   * @param {string} message 用户输入消息
   */
  static _assertChatRequest(message) {
    return AIChatAppService._assertChatRequest(message);
  }

  /**
   * 构建对话上下文，包括会话 ID、历史消息和当前用户消息。
   *
   * @param {string} message 用户输入消息
   * @param {string} [sessionId] 会话 ID
   * @returns {{ resolvedSessionId: string, history: Array, userMessage: { role: string, content: string } }}
   */
  static _createChatContext(message, sessionId) {
    return sessionStore.createContext(message, sessionId);
  }

  /**
   * 创建统一 chat runtime（含非流式与流式入口）。
   *
   * @param {{ generate: Function }} provider LLM Provider
   * @returns {{ run: Function, runStream: Function }}
   */
  static _createChatRuntime(provider) {
    return createChatRuntime({ provider });
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
    return AIChatAppService._buildToolStatus(parsedData);
  }

  /**
   * 判断分享链接是否仍为占位值。
   *
   * @param {string} url 分享链接
   * @returns {boolean}
   */
  static _isPlaceholderShareUrl(url) {
    return AIChatAppService._isPlaceholderShareUrl(url);
  }

  /**
   * 生成新的会话 ID。
   *
   * @returns {string}
   */
  static _createSessionId() {
    return sessionStore.createSessionId();
  }

  /**
   * 获取指定会话的历史消息。
   *
   * @param {string} sessionId 会话 ID
   * @returns {Array}
   */
  static _getSessionMessages(sessionId) {
    return sessionStore.getMessages(sessionId);
  }

  /**
   * 保存当前轮次的用户消息和助手回复，并按配置裁剪历史长度。
   *
   * @param {string} sessionId 会话 ID
   * @param {{ role: string, content: string }} userMessage 当前用户消息
   * @param {string} reply 助手回复
   */
  static _saveSession(sessionId, userMessage, reply) {
    sessionStore.saveTurn(sessionId, userMessage, reply);
  }

  /**
   * 规范化模型返回内容，提取 thinking 和最终 reply。
   *
   * @param {string} content 模型原始输出
   * @param {object|null} parsedData 抖音解析结果
   * @returns {{ thinking: string, reply: string }}
   */
  static _normalizeAssistantReply(content, parsedData) {
    return normalizeAssistantReply(content, parsedData);
  }

  /**
   * 在流式输出过程中拆分思考内容与最终回复。
   *
   * @param {string} content 当前累计输出内容
   * @returns {{ thinking: string, reply: string }}
   */
  static _splitStreamingAssistantReply(content) {
    return splitStreamingAssistantReply(content);
  }

  /**
   * 移除供应商注入的工具调用标记。
   *
   * @param {string} content 模型原始输出
   * @param {{ allowPartialTail?: boolean }} [options] 是否允许处理尾部不完整标签
   * @returns {string}
   */
  static _stripVendorToolCallMarkup(content, options) {
    return stripVendorToolCallMarkup(content, options);
  }

  /**
   * 从完整输出中拆分 think 内容与最终回复正文。
   *
   * @param {string} content 模型输出
   * @returns {{ thinking: string, reply: string }}
   */
  static _splitThinkingAndReply(content) {
    return splitThinkingAndReply(content);
  }

  /**
   * 当模型未返回可用答复时，根据解析结果生成兜底文案。
   *
   * @param {object|null} parsedData 抖音解析结果
   * @returns {string}
   */
  static _buildFallbackReply(parsedData) {
    return buildFallbackReply(parsedData);
  }
}

module.exports = AIChatService;
