const OpenAI = require('openai');

class OpenAICompatibleProvider {
  constructor(options) {
    if (!options || !options.apiKey) {
      const error = new Error('LLM API key is not configured');
      error.statusCode = 500;
      throw error;
    }

    this.options = options;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: options.requestTimeoutMs
    });
  }

  getName() {
    return this.options.provider;
  }

  async generate({ messages, tools = [], toolChoice = 'auto' }) {
    try {
      const response = await this.client.chat.completions.create({
        model: this.options.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? toolChoice : undefined,
        temperature: this.options.temperature,
        max_tokens: this.options.maxTokens
      });

      return this._normalizeResponse(response);
    } catch (error) {
      const wrappedError = new Error(error.message || 'LLM request failed');
      wrappedError.statusCode = error.status || error.statusCode || 502;
      wrappedError.cause = error;
      throw wrappedError;
    }
  }

  _normalizeResponse(response) {
    const message = response?.choices?.[0]?.message || {};

    return {
      content: this._normalizeContent(message.content),
      toolCalls: (message.tool_calls || []).map((toolCall) => ({
        id: toolCall.id,
        type: toolCall.type,
        name: toolCall.function?.name,
        arguments: toolCall.function?.arguments || '{}'
      })),
      rawMessage: message
    };
  }

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
          return item?.text || '';
        })
        .filter(Boolean)
        .join('\n');
    }

    return '';
  }
}

module.exports = OpenAICompatibleProvider;
