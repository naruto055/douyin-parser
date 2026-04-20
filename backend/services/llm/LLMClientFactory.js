const config = require('../../config');
const OpenAICompatibleProvider = require('./OpenAICompatibleProvider');

class LLMClientFactory {
  static create() {
    if (config.ai.provider !== 'openai-compatible') {
      const error = new Error(`Unsupported LLM provider: ${config.ai.provider}`);
      error.statusCode = 500;
      throw error;
    }

    return new OpenAICompatibleProvider(config.ai);
  }
}

module.exports = LLMClientFactory;
