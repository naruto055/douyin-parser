const { ChatOpenAI } = require('@langchain/openai');

/**
 * 基于当前 AI 配置创建 LangChain ChatOpenAI 模型实例。
 *
 * @param {object} options 模型配置项
 * @param {string} options.apiKey API Key
 * @param {string} options.baseURL OpenAI 兼容服务地址
 * @param {string} options.model 模型名称
 * @param {number} [options.temperature] 温度参数
 * @param {number} [options.maxTokens] 最大输出 token
 * @param {number} [options.requestTimeoutMs] 请求超时时间（毫秒）
 * @param {{ ChatOpenAI?: new (options: object) => any }} [dependencies] 可注入依赖（测试用）
 * @returns {import('@langchain/openai').ChatOpenAI} LangChain 模型实例
 */
function createChatModel(options = {}, dependencies = {}) {
  const { ChatOpenAI: ChatOpenAIClass = ChatOpenAI } = dependencies;
  const apiKey = String(options.apiKey || '').trim();

  if (!apiKey) {
    const error = new Error('LLM API key is not configured');
    error.statusCode = 500;
    throw error;
  }

  return new ChatOpenAIClass({
    apiKey,
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    streamUsage: false,
    timeout: options.requestTimeoutMs,
    configuration: {
      apiKey,
      baseURL: options.baseURL,
      timeout: options.requestTimeoutMs
    }
  });
}

module.exports = createChatModel;
