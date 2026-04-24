const config = require('../../config');
const AISessionStore = require('../sessions/AISessionStore');
const createChatRuntime = require('../runtime/createChatRuntime');
const { normalizeAssistantReply, buildFallbackReply } = require('../runtime/messageNormalizer');
const LLMClientFactory = require('../../services/llm/LLMClientFactory');

/**
 * 共享的 AI 会话存储实例。
 *
 * 作用：
 * - 在应用服务层统一管理多轮对话上下文。
 * - 让同一个进程内的所有非流式 AI 对话请求都复用同一份内存会话仓库。
 *
 * 说明：
 * - 这里使用模块级单例，避免每次请求都重新创建会话存储器。
 * - 这符合当前内存态会话管理的简单设计，避免不必要的对象重复创建。
 */
const sessionStore = new AISessionStore();

/**
 * AIChatAppService 是非流式 AI 对话的应用服务。
 *
 * 主要职责：
 * 1. 校验 AI 对话请求是否合法。
 * 2. 创建大模型客户端与对话运行时。
 * 3. 从会话存储中读取历史上下文并构造当前轮用户消息。
 * 4. 调用运行时执行一次完整的非流式对话。
 * 5. 解析工具执行结果和模型回复，并保存回会话历史。
 *
 * 设计定位：
 * - 该类属于 application 层，负责组织业务流程，而不是实现底层能力细节。
 * - 它协调 config、LLMClientFactory、ChatRuntime、AISessionStore 等组件完成一次完整请求。
 */
class AIChatAppService {
  /**
   * 处理非流式对话请求，必要时调用抖音解析工具补充上下文。
   *
   * @param {string} message 用户输入消息
   * @param {string} [sessionId] 会话 ID
   * @returns {Promise<{thinking: string, reply: string, sessionId: string, parsedData: object|null, toolStatus: object|null}>}
   */
  static async chat(message, sessionId) {
    /**
     * 校验请求前置条件。
     *
     * `this._assertChatRequest(message)` 的作用：
     * - 检查 AI 功能是否启用。
     * - 检查用户消息是否为空。
     * - 如果不满足条件，直接抛出带状态码的错误，阻止后续流程继续执行。
     */
    this._assertChatRequest(message);

    /**
     * 当前请求所使用的大模型客户端实例。
     *
     * `LLMClientFactory.create()` 的作用：
     * - 根据当前配置创建合适的 LLM 客户端实现。
     * - 对上层屏蔽不同大模型提供商之间的差异。
     */
    const provider = LLMClientFactory.create();

    /**
     * 当前请求的对话运行时对象。
     *
     * `createChatRuntime({ provider })` 的作用：
     * - 基于当前大模型客户端构造聊天运行时。
     * - 运行时会封装消息组织、工具调用、模型请求等完整流程。
     */
    const runtime = createChatRuntime({ provider });

    /**
     * 当前轮对话所需的会话上下文。
     *
     * `sessionStore.createContext(message, sessionId)` 的作用：
     * - 解析出最终会话 ID。
     * - 读取该会话已有历史消息。
     * - 构建当前轮用户消息对象。
     */
    const { resolvedSessionId, history, userMessage } = sessionStore.createContext(message, sessionId);

    /**
     * parsedData:
     * - 工具链（例如抖音解析工具）执行后的结构化结果。
     * - 初始为 null，表示当前还没有工具结果。
     */
    let parsedData = null;

    /**
     * toolStatus:
     * - 基于 parsedData 衍生出来的工具执行状态摘要。
     * - 例如是否存在告警、结果是否可疑。
     */
    let toolStatus = null;

    /**
     * thinking:
     * - 归一化后的“思考内容”或阶段性说明文本。
     * - 具体值由 normalizeAssistantReply 负责从原始模型输出中提取。
     */
    let thinking = '';

    /**
     * reply:
     * - 最终返回给前端或调用方的助手回复正文。
     */
    let reply = '';

    console.log(`[AI] provider=${provider.getName()} model=${config.ai.model} session=${resolvedSessionId}`);

    try {
      /**
       * 执行一次完整的非流式聊天运行。
       *
       * `runtime.run(...)` 的作用：
       * - 把历史消息和当前用户消息交给运行时。
       * - 由运行时决定是否调用工具、如何调用模型，并返回最终结果。
       */
      const runtimeResult = await runtime.run({
        history,
        userMessage
      });

      /**
       * 从运行时结果中提取结构化工具数据。
       */
      parsedData = runtimeResult.parsedData;

      /**
       * 基于工具结果生成状态摘要。
       *
       * `this._buildToolStatus(parsedData)` 的作用：
       * - 根据解析结果判断工具执行结果是否可靠。
       * - 生成统一的状态对象供上层展示或调试。
       */
      toolStatus = this._buildToolStatus(parsedData);

      /**
       * 归一化模型返回内容。
       *
       * `normalizeAssistantReply(runtimeResult.content, parsedData)` 的作用：
       * - 从运行时原始输出中提取结构化的 thinking 和 reply。
       * - 必要时结合 parsedData 对回复内容进行整理。
       *
       * 这里使用解构赋值，是为了把归一化结果直接拆成两个明确字段。
       */
      ({ thinking, reply } = normalizeAssistantReply(runtimeResult.content, parsedData));
    } catch (error) {
      /**
       * 对工具参数校验错误做统一转换。
       *
       * `error.name === 'ZodError'` 的作用：
       * - 判断异常是否来自基于 Zod 的参数校验失败。
       *
       * 转换为 400 错误的原因：
       * - 这类错误本质上是请求参数或工具参数不合法，而不是服务端内部故障。
       */
      if (error.name === 'ZodError') {
        const validationError = new Error('Invalid tool arguments');
        validationError.statusCode = 400;
        throw validationError;
      }
      throw error;
    }

    /**
     * 将本轮问答写回会话历史。
     *
     * `sessionStore.saveTurn(...)` 的作用：
     * - 把当前用户消息和最终助手回复保存到指定 session 中。
     * - 同时按会话上限裁剪旧历史。
     */
    sessionStore.saveTurn(resolvedSessionId, userMessage, reply);

    return {
      thinking,
      reply,
      sessionId: resolvedSessionId,
      parsedData,
      toolStatus
    };
  }

  /**
   * 校验 AI 对话请求的前置条件。
   *
   * @param {string} message 用户输入消息
   */
  static _assertChatRequest(message) {
    /**
     * `config.ai.enabled` 的作用：
     * - 控制 AI 功能总开关。
     * - 关闭时直接拒绝请求，避免后续继续访问模型服务。
     */
    if (!config.ai.enabled) {
      const error = new Error('AI chat is disabled');
      error.statusCode = 403;
      throw error;
    }

    /**
     * `String(message).trim()` 的作用：
     * - 统一把输入转换成字符串后再去除首尾空白。
     * - 防止空字符串、纯空格等无效消息进入后续流程。
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
     * 工具执行告警列表。
     *
     * 作用：
     * - 收集当前工具结果中发现的潜在异常或可疑标记。
     */
    const warnings = [];

    /**
     * 从解析结果中提取并标准化分享链接。
     *
     * `String(parsedData.shareUrl || '').trim()` 的作用：
     * - 保证 shareUrl 一定是可判断的字符串。
     * - 去掉首尾空白，避免格式判断受干扰。
     */
    const shareUrl = String(parsedData.shareUrl || '').trim();

    /**
     * `this._isPlaceholderShareUrl(shareUrl)` 的作用：
     * - 检查解析结果里的分享链接是否仍然只是占位值。
     * - 若是占位值，说明工具结果可能不完整或不可靠。
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
    
    return /^https?:\/\/v\.douyin\.com\/x{5,}\/?$/i.test(url);
  }

  /**
   * 当模型未返回可用答复时，根据解析结果生成兜底文案。
   *
   * @param {object|null} parsedData 抖音解析结果
   * @returns {string}
   */
  static _buildFallbackReply(parsedData) {
    /**
     * `buildFallbackReply(parsedData)` 的作用：
     * - 根据已有解析数据生成一个保底回复。
     * - 避免模型输出为空或不可用时，调用方拿不到可展示内容。
     */
    return buildFallbackReply(parsedData);
  }
}

module.exports = AIChatAppService;
