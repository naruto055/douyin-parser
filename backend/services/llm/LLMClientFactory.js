const config = require('../../config');
const createChatModel = require('../../ai/infra/model/createChatModel');
const LangChainProvider = require('../../ai/infra/model/LangChainProvider');

/**
 * LLM 客户端工厂，负责根据配置创建对应的模型提供方实例。
 */
class LLMClientFactory {
  /**
   * 按当前系统配置创建 LLM Provider。
   *
   * @param {{
   *  createChatModel?: Function,
   *  LangChainProvider?: new (options: object, dependencies: object) => any
   * }} [dependencies]
   * @returns {{ generate: Function, streamGenerate: Function, getName: Function }} 可用的 LLM Provider 实例
   */
  static create(dependencies = {}) {
    if (config.ai.provider !== 'openai-compatible') {
      // 当前仅实现了 OpenAI 兼容协议的 Provider，其它类型直接显式报错。
      const error = new Error(`Unsupported LLM provider: ${config.ai.provider}`);
      error.statusCode = 500;
      throw error;
    }
    
    const createModel = dependencies.createChatModel || createChatModel;
    const model = createModel(config.ai);
    const ProviderClass = dependencies.LangChainProvider || LangChainProvider;
    return new ProviderClass(config.ai, { model });
  }
}

module.exports = LLMClientFactory;
