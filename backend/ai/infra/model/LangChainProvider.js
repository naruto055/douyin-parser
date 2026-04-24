/**
 * 基于 LangChain ChatModel 的标准 provider，实现统一的 generate/streamGenerate 接口。
 * 该类的职责是对外屏蔽底层模型实现细节，让上层应用始终通过一致的协议访问 LLM。
 * 当前它主要负责：
 * 1. 在初始化阶段校验必要依赖是否存在；
 * 2. 将普通调用与流式调用统一适配到 LangChain 模型；
 * 3. 在启用 tools 时构造可执行的 runnable；
 * 4. 将 LangChain 返回结果规范化为系统内部约定的数据结构；
 * 5. 将底层异常包装为更稳定的应用层错误。
 */
class LangChainProvider {
  /**
   * 创建 Provider 实例，并保存运行时所需的配置和模型对象。
   *
   * @param {object} options
   * @param {string} options.apiKey 用于校验当前 Provider 是否具备调用模型的基本配置
   * @param {string} options.provider Provider 名称，供 getName 返回给上层使用
   * @param {{ model: any }} dependencies
   * @param {any} dependencies.model 已创建好的 LangChain ChatModel 实例
   */
  constructor(options, dependencies = {}) {
    const apiKey = String(options?.apiKey || '').trim();
    if (!apiKey) {
      const error = new Error('LLM API key is not configured');
      error.statusCode = 500;
      throw error;
    }

    if (!dependencies.model) {
      const error = new Error('LangChain provider requires a chat model');
      error.statusCode = 500;
      throw error;
    }

    this.options = options;
    this.model = dependencies.model;
  }

  getName() {
    return this.options.provider;
  }

  /**
   * 执行一次非流式生成。
   * 返回值会被标准化，避免上层直接依赖 LangChain 的原始消息结构。
   *
   * @param {{
   *   messages: any[],
   *   tools?: any[],
   *   toolChoice?: string
   * }} params
   * @returns {Promise<{
   *   content: string,
   *   toolCalls: Array<{ id: string, type: string, name: string, arguments: string }>,
   *   rawMessage: object
   * }>}
   */
  async generate({ messages, tools = [], toolChoice = 'auto' }) {
    try {
      // 先基于 tools 配置构建可执行对象；没有 tools 时直接使用原始模型。
      const runnable = this._buildRunnable(tools, toolChoice);
      const response = await runnable.invoke(messages);

      return {
        // content/toolCalls 是系统内部统一消费的核心字段。
        content: this._normalizeContent(response?.content),
        toolCalls: this._normalizeToolCalls(response),
        // rawMessage 保留底层响应，便于诊断问题或后续扩展。
        rawMessage: response || {}
      };
    } catch (error) {
      throw this._wrapError(error);
    }
  }

  /**
   * 执行一次流式生成。
   * 该方法返回 AsyncGenerator，调用方可以逐段消费模型输出。
   *
   * @param {{
   *   messages: any[],
   *   tools?: any[],
   *   toolChoice?: string
   * }} params
   * @yields {{ type: 'content_delta', delta: string }}
   */
  async *streamGenerate({ messages, tools = [], toolChoice = 'auto' }) {
    try {
      const runnable = this._buildRunnable(tools, toolChoice);
      const stream = await runnable.stream(messages);

      for await (const chunk of stream) {
        // LangChain 的 chunk 结构可能不稳定，先统一抽取文本增量。
        const contentDelta = this._normalizeContent(chunk?.content);
        if (!contentDelta) {
          // 忽略空片段，避免上层收到无意义事件。
          continue;
        }

        yield {
          type: 'content_delta',
          delta: contentDelta
        };
      }
    } catch (error) {
      throw this._wrapError(error);
    }
  }

  /**
   * 根据是否传入 tools，返回最终可执行的 runnable。
   *
   * 设计意图：
   * - 无 tools：直接返回原始模型，保持最短调用路径；
   * - 有 tools 且模型支持 bindTools：优先使用 LangChain 的标准工具绑定能力；
   * - 否则尝试退回到更通用的 bind 接口；
   * - 两者都不支持时，明确抛错，避免静默失败。
   *
   * @param {any[]} tools
   * @param {string} toolChoice
   * @returns {any}
   */
  _buildRunnable(tools, toolChoice) {
    if (!Array.isArray(tools) || tools.length === 0) {
      return this.model;
    }

    if (typeof this.model.bindTools === 'function') {
      return this.model.bindTools(tools, { tool_choice: toolChoice });
    }

    if (typeof this.model.bind === 'function') {
      return this.model.bind({
        tools,
        tool_choice: toolChoice
      });
    }

    const error = new Error('LLM model does not support tool binding');
    error.statusCode = 500;
    throw error;
  }

  /**
   * 将 LangChain 返回的工具调用信息规范化为统一结构。
   *
   * 兼容两类数据来源：
   * 1. 新结构：message.tool_calls
   * 2. 旧/兼容结构：message.additional_kwargs.tool_calls
   *
   * @param {object} message
   * @returns {Array<{ id: string, type: string, name: string, arguments: string }>}
   */
  _normalizeToolCalls(message) {
    const langChainToolCalls = Array.isArray(message?.tool_calls)
      ? message.tool_calls
      : [];

    if (langChainToolCalls.length > 0) {
      return langChainToolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        name: toolCall.name || toolCall.function?.name,
        arguments: this._normalizeToolArguments(toolCall.args ?? toolCall.function?.arguments)
      }));
    }

    const rawToolCalls = Array.isArray(message?.additional_kwargs?.tool_calls)
      ? message.additional_kwargs.tool_calls
      : [];

    return rawToolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: toolCall.type || 'function',
      name: toolCall.function?.name,
      arguments: this._normalizeToolArguments(toolCall.function?.arguments)
    }));
  }

  /**
   * 将工具参数统一转成字符串，便于与 OpenAI 风格的 function call 格式保持一致。
   *
   * @param {unknown} args
   * @returns {string}
   */
  _normalizeToolArguments(args) {
    if (typeof args === 'string') {
      return args;
    }

    if (args && typeof args === 'object') {
      return JSON.stringify(args);
    }

    return '{}';
  }

  /**
   * 统一提取模型返回内容。
   *
   * LangChain 的 content 可能是：
   * - 纯字符串；
   * - 分段数组；
   * - 带 text/content 字段的对象数组。
   *
   * 这里统一收敛为单个字符串，减少上层分支判断。
   *
   * @param {unknown} content
   * @returns {string}
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

          if (typeof item?.text === 'string') {
            return item.text;
          }

          if (typeof item?.content === 'string') {
            return item.content;
          }

          return '';
        })
        .filter(Boolean)
        .join('\n');
    }

    return '';
  }

  /**
   * 将底层异常包装成系统统一错误。
   * 这样上层可以稳定依赖 message/statusCode，而不需要理解具体 SDK 的错误格式。
   *
   * @param {any} error
   * @returns {Error & { statusCode?: number, cause?: any }}
   */
  _wrapError(error) {
    const wrappedError = new Error(error?.message || 'LLM request failed');
    wrappedError.statusCode = error?.status || error?.statusCode || 502;
    wrappedError.cause = error;
    return wrappedError;
  }
}

module.exports = LangChainProvider;
