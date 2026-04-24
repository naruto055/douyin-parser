const config = require('../../config');
const AISessionStore = require('../sessions/AISessionStore');
const createChatRuntime = require('../runtime/createChatRuntime');
const StreamEventAdapter = require('../runtime/streamEventAdapter');
const LLMClientFactory = require('../../services/llm/LLMClientFactory');

/**
 * 共享的 AI 会话存储实例。
 *
 * 作用：
 * - 在流式对话场景下统一保存和读取会话历史。
 * - 让同一进程中的流式请求可以按 sessionId 延续多轮上下文。
 */
const sessionStore = new AISessionStore();

/**
 * AIStreamAppService 是流式 AI 对话的应用服务。
 *
 * 主要职责：
 * 1. 校验流式 AI 请求是否合法。
 * 2. 创建大模型客户端和聊天运行时。
 * 3. 组织历史上下文和当前用户消息。
 * 4. 通过运行时逐步接收流式事件，并借助事件适配器对外发出统一事件。
 * 5. 在流结束后归一化最终结果并写入会话历史。
 *
 * 与非流式服务的区别：
 * - 非流式服务在拿到完整结果后一次性返回。
 * - 流式服务会在执行过程中持续通过回调向外推送中间状态和增量内容。
 */
class AIStreamAppService {
  /**
   * 处理流式对话请求，并通过事件回调持续推送阶段性结果。
   *
   * @param {string} message 用户输入消息
   * @param {string} [sessionId] 会话 ID
   * @param {{ onEvent?: Function }} [options] 流式事件处理配置
   * @returns {Promise<{thinking: string, reply: string, sessionId: string, parsedData: object|null, toolStatus: object|null}>}
   */
  static async chatStream(message, sessionId, { onEvent } = {}) {
    /**
     * 校验请求前置条件。
     *
     * `this._assertChatRequest(message)` 的作用：
     * - 检查 AI 能力是否启用。
     * - 检查输入消息是否有效。
     */
    this._assertChatRequest(message);

    /**
     * 当前请求使用的大模型客户端实例。
     *
     * `LLMClientFactory.create()` 的作用：
     * - 根据配置选择并创建对应的 LLM 客户端。
     */
    const provider = LLMClientFactory.create();

    /**
     * 当前请求的聊天运行时。
     *
     * `createChatRuntime({ provider })` 的作用：
     * - 生成一个可执行流式聊天流程的运行时对象。
     */
    const runtime = createChatRuntime({ provider });

    /**
     * 当前轮流式请求所需的会话上下文。
     *
     * `sessionStore.createContext(...)` 的作用：
     * - 解析会话 ID。
     * - 获取已有历史消息。
     * - 生成当前轮用户消息对象。
     */
    const { resolvedSessionId, history, userMessage } = sessionStore.createContext(message, sessionId);

    /**
     * 统一的事件发送函数。
     *
     * `typeof onEvent === 'function' ? onEvent : () => {}` 的作用：
     * - 如果调用方提供了事件处理函数，则使用它。
     * - 否则回退为一个空函数，避免每次 emit 前都要做判空判断。
     */
    const emit = typeof onEvent === 'function' ? onEvent : () => {};

    /**
     * 流式事件适配器。
     *
     * 作用：
     * - 消费运行时内部产生的原始流式事件。
     * - 将这些事件转换为更稳定、对外更友好的事件格式。
     *
     * `buildToolStatus` 回调的作用：
     * - 在事件处理中按需基于最新 parsedData 生成工具状态。
     */
    const streamAdapter = new StreamEventAdapter({
      emit,
      buildToolStatus: (nextParsedData) => this._buildToolStatus(nextParsedData)
    });

    /**
     * parsedData:
     * - 工具执行得到的结构化结果，初始为空。
     */
    let parsedData = null;

    /**
     * toolStatus:
     * - 基于 parsedData 生成的工具执行状态摘要。
     */
    let toolStatus = null;

    /**
     * thinking:
     * - 最终汇总后的思考内容或过程性文本。
     */
    let thinking = '';

    /**
     * reply:
     * - 最终汇总后的助手回复正文。
     */
    let reply = '';

    /**
     * runtimeContent:
     * - 运行时返回的原始完整内容。
     * - 在流式过程中可能由多个增量片段组成，最终用于做归一化汇总。
     */
    let runtimeContent = '';

    console.log(`[AI] provider=${provider.getName()} model=${config.ai.model} session=${resolvedSessionId} stream=true`);

    /**
     * 先向外发送 session 事件，告知调用方本次请求使用的会话 ID。
     *
     * `emit('session', { sessionId: resolvedSessionId })` 的作用：
     * - 让前端或上层调用方尽早拿到会话标识，便于后续继续对话。
     */
    emit('session', { sessionId: resolvedSessionId });

    try {
      /**
       * 执行一次流式聊天运行。
       *
       * `runtime.runStream(...)` 的作用：
       * - 以流式方式执行聊天流程。
       * - 在模型生成或工具执行过程中，通过 `onRuntimeEvent` 连续推送内部事件。
       */
      const runtimeResult = await runtime.runStream({
        history,
        userMessage,
        onRuntimeEvent(event) {
          /**
           * `streamAdapter.consume(event)` 的作用：
           * - 把运行时内部事件交给适配器处理。
           * - 适配器会负责累计状态、转换结构并调用 emit 向外转发。
           */
          streamAdapter.consume(event);
        }
      });

      /**
       * 提取流式运行结束后的结构化结果与原始内容。
       */
      parsedData = runtimeResult.parsedData;
      runtimeContent = runtimeResult.content;
    } catch (error) {
      /**
       * 将 Zod 参数校验错误统一转换为 400。
       */
      if (error.name === 'ZodError') {
        const validationError = new Error('Invalid tool arguments');
        validationError.statusCode = 400;
        throw validationError;
      }
      throw error;
    }

    /**
     * 对流式累计结果做最终归一化。
     *
     * `streamAdapter.finalize(...)` 的作用：
     * - 基于流过程中累计的信息和最终原始内容，生成标准化结果。
     * - 保证返回结构与非流式服务尽量一致。
     */
    const normalizedResult = streamAdapter.finalize({
      parsedData,
      content: runtimeContent
    });

    /**
     * 从归一化结果中提取最终 thinking 和 reply。
     */
    thinking = normalizedResult.thinking;
    reply = normalizedResult.reply;

    /**
     * 根据最终工具结果生成工具状态。
     */
    toolStatus = this._buildToolStatus(parsedData);

    /**
     * 保存本轮问答到会话历史。
     */
    sessionStore.saveTurn(resolvedSessionId, userMessage, reply);

    /**
     * 最终返回结果对象。
     *
     * 作用：
     * - 既作为方法返回值，也作为 `done` 事件载荷向外发送。
     */
    const result = {
      thinking,
      reply,
      sessionId: resolvedSessionId,
      parsedData,
      toolStatus
    };

    /**
     * 发出流式完成事件。
     *
     * `emit('done', result)` 的作用：
     * - 告知调用方本次流式过程已经结束，并附上完整结果。
     */
    emit('done', result);
    return result;
  }

  /**
   * 校验 AI 对话请求的前置条件。
   *
   * @param {string} message 用户输入消息
   */
  static _assertChatRequest(message) {
    /**
     * 检查 AI 功能是否启用。
     */
    if (!config.ai.enabled) {
      const error = new Error('AI chat is disabled');
      error.statusCode = 403;
      throw error;
    }

    /**
     * 检查用户输入是否为空。
     *
     * `String(message).trim()` 的作用：
     * - 统一把输入标准化为字符串。
     * - 去掉空白字符后再判断是否为有效文本。
     */
    if (!message || !String(message).trim()) {
      const error = new Error('message is required');
      error.statusCode = 400;
      throw error;
    }
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

    /**
     * 工具结果告警列表。
     */
    const warnings = [];

    /**
     * 标准化后的分享链接。
     */
    const shareUrl = String(parsedData.shareUrl || '').trim();

    /**
     * 检查是否仍然是占位分享链接。
     */
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

    /**
     * 判断链接是否符合“占位分享链接”模式。
     *
     * 作用：
     * - 如果还是占位值，则说明工具结果可能不完整。
     */
    return /^https?:\/\/v\.douyin\.com\/x{5,}\/?$/i.test(url);
  }
}

module.exports = AIStreamAppService;
