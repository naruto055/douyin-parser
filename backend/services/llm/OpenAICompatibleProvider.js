const OpenAI = require('openai');

/**
 * 基于 OpenAI SDK 的兼容层实现，用于对接支持 OpenAI 协议的模型服务。
 */
class OpenAICompatibleProvider {
  /**
   * 初始化 Provider，并创建底层 OpenAI 客户端。
   *
   * @param {object} options LLM 配置项
   * @param {string} options.apiKey API Key
   * @param {string} options.baseURL OpenAI 兼容服务地址
   * @param {number} options.requestTimeoutMs 请求超时时间
   */
  constructor(options) {
    if (!options || !options.apiKey) {
      // API Key 缺失属于服务端配置错误，直接中断初始化。
      const error = new Error('LLM API key is not configured');
      error.statusCode = 500;
      throw error;
    }

    this.options = options;
    // 统一在构造阶段创建 SDK 客户端，后续请求可直接复用。
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: options.requestTimeoutMs
    });
  }

  /**
   * 获取当前 Provider 名称。
   *
   * @returns {string} Provider 标识
   */
  getName() {
    return this.options.provider;
  }

  /**
   * 发起一次非流式对话生成请求。
   *
   * @param {object} params 请求参数
   * @param {Array} params.messages 对话消息列表
   * @param {Array} [params.tools=[]] 可选工具定义
   * @param {string|object} [params.toolChoice='auto'] 工具选择策略
   * @returns {Promise<{content: string, toolCalls: Array, rawMessage: object}>} 标准化响应
   */
  async generate({ messages, tools = [], toolChoice = 'auto' }) {
    try {
      const response = await this.client.chat.completions.create({
        model: this.options.model,
        messages,
        // 无工具时不传相关字段，避免部分兼容实现对空数组兼容性较差。
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? toolChoice : undefined,
        temperature: this.options.temperature,
        max_tokens: this.options.maxTokens
      });

      return this._normalizeResponse(response);
    } catch (error) {
      // 统一包装上游异常，向业务层暴露稳定的错误结构。
      const wrappedError = new Error(error.message || 'LLM request failed');
      wrappedError.statusCode = error.status || error.statusCode || 502;
      wrappedError.cause = error;
      throw wrappedError;
    }
  }

  /**
   * 发起流式对话生成请求，并按增量内容逐段输出。
   *
   * @param {object} params 请求参数
   * @param {Array} params.messages 对话消息列表
   * @param {Array} [params.tools=[]] 可选工具定义
   * @param {string|object} [params.toolChoice='auto'] 工具选择策略
   * @yields {{type: string, delta: string}} 内容增量事件
   */
  async *streamGenerate({ messages, tools = [], toolChoice = 'auto' }) {
    try {
      const stream = await this.client.chat.completions.create({
        model: this.options.model,
        messages,
        // 流式接口同样复用统一的工具与模型配置。
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? toolChoice : undefined,
        temperature: this.options.temperature,
        max_tokens: this.options.maxTokens,
        stream: true
      });

      for await (const chunk of stream) {
        const delta = chunk?.choices?.[0]?.delta;

        if (!delta?.content) {
          // 过滤空增量或非文本片段，避免向上游发送无意义事件。
          continue;
        }

        yield {
          type: 'content_delta',
          delta: this._normalizeContent(delta.content)
        };
      }
    } catch (error) {
      // 与非流式接口保持一致的异常语义，便于上层统一处理。
      const wrappedError = new Error(error.message || 'LLM request failed');
      wrappedError.statusCode = error.status || error.statusCode || 502;
      wrappedError.cause = error;
      throw wrappedError;
    }
  }

  /**
   * 将 OpenAI SDK 的原始响应转换为内部统一结构。
   *
   * @param {object} response SDK 原始响应
   * @returns {{content: string, toolCalls: Array, rawMessage: object}} 统一响应对象
   */
  _normalizeResponse(response) {
    const message = response?.choices?.[0]?.message || {};

    return {
      content: this._normalizeContent(message.content),
      // 将工具调用参数摊平成稳定字段，降低业务层对 SDK 数据结构的耦合。
      toolCalls: (message.tool_calls || []).map((toolCall) => ({
        id: toolCall.id,
        type: toolCall.type,
        name: toolCall.function?.name,
        arguments: toolCall.function?.arguments || '{}'
      })),
      rawMessage: message
    };
  }

  /**
   * 将不同格式的消息内容统一整理为纯文本。
   *
   * @param {string|Array|any} content 模型返回的内容
   * @returns {string} 归一化后的文本内容
   */
  _normalizeContent(content) {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === 'string') {
            return item;
          }
          // 兼容多段富文本结构，优先提取 text 字段。
          return item?.text || '';
        })
        .filter(Boolean)
        // 使用换行拼接分段内容，尽量保留原始文本层次。
        .join('\n');
    }

    // 未识别的内容结构统一降级为空字符串，避免向上层泄露复杂对象。
    return '';
  }
}

module.exports = OpenAICompatibleProvider;
