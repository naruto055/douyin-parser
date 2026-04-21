const config = require('../../config');
const OpenAICompatibleProvider = require('./OpenAICompatibleProvider');

/**
 * LLM 客户端工厂，负责根据配置创建对应的模型提供方实例。
 */
class LLMClientFactory {
  /**
   * 按当前系统配置创建 LLM Provider。
   *
   * @returns {OpenAICompatibleProvider} 可用的 LLM Provider 实例
   */
  static create() {
    if (config.ai.provider !== 'openai-compatible') {
      // 当前仅实现了 OpenAI 兼容协议的 Provider，其它类型直接显式报错。
      const error = new Error(`Unsupported LLM provider: ${config.ai.provider}`);
      error.statusCode = 500;
      throw error;
    }

    // 将 AI 配置整体传入 Provider，由 Provider 自行消费所需字段。
    return new OpenAICompatibleProvider(config.ai);
  }
}

module.exports = LLMClientFactory;
