const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../config');
const LLMClientFactory = require('../services/llm/LLMClientFactory');

test('LLMClientFactory 默认返回 LangChainProvider', () => {
  const originalProvider = config.ai.provider;

  config.ai.provider = 'openai-compatible';

  class FakeProvider {
    constructor(options, dependencies) {
      this.options = options;
      this.dependencies = dependencies;
    }
  }

  try {
    const provider = LLMClientFactory.create({
      createChatModel() {
        return { fake: 'model' };
      },
      LangChainProvider: FakeProvider
    });

    assert.ok(provider instanceof FakeProvider);
    assert.equal(provider.options.provider, 'openai-compatible');
    assert.deepEqual(provider.dependencies.model, { fake: 'model' });
  } finally {
    config.ai.provider = originalProvider;
  }
});

test('LLMClientFactory 会忽略无关注入参数并保持默认 provider', () => {
  class FakeProvider {
    constructor(options, dependencies) {
      this.options = options;
      this.dependencies = dependencies;
    }
  }

  const provider = LLMClientFactory.create({
    runtimeMode: 'legacy',
    createChatModel() {
      return { fake: 'model' };
    },
    LangChainProvider: FakeProvider
  });

  assert.ok(provider instanceof FakeProvider);
  assert.deepEqual(provider.dependencies.model, { fake: 'model' });
});

test('配置中不再暴露 AI runtime 开关', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(config.ai, 'runtime'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(config.ai, 'streamRuntime'), false);
});
