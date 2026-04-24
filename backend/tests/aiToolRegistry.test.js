const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const { createLangChainToolAdapter } = require('../ai/infra/langchain/langChainToolAdapterFactory');
const toolRegistry = require('../ai/tools');
const parseDouyinVideoTool = require('../services/tools/parseDouyinVideoTool');

test('createLangChainToolAdapter 基于 zod schema 创建 LangChain 工具适配器', async () => {
  const sampleTool = createLangChainToolAdapter({
    name: 'sample_tool',
    description: '示例工具',
    inputSchema: z.object({
      text: z.string().trim().min(1)
    }),
    execute: async (input) => ({
      upperText: input.text.toUpperCase()
    })
  });

  assert.equal(sampleTool.name, 'sample_tool');

  const result = await sampleTool.invoke({ text: 'demo' });
  assert.equal(result.upperText, 'DEMO');
});

test('createLangChainToolAdapter 会复用 zod schema 校验输入', async () => {
  const sampleTool = createLangChainToolAdapter({
    name: 'schema_tool',
    description: 'schema 校验示例',
    inputSchema: z.object({
      url: z.string().trim().min(1)
    }),
    execute: async (input) => input
  });

  await assert.rejects(
    () => sampleTool.invoke({}),
    (error) => {
      assert.match(error.message, /did not match expected schema/i);
      return true;
    }
  );
});

test('createLangChainToolAdapter 在缺少 inputSchema 时应快速失败', () => {
  assert.throws(
    () => createLangChainToolAdapter({
      name: 'missing_schema_tool',
      description: '缺少 schema 的工具',
      execute: async (input) => input
    }),
    /inputSchema must be a Zod schema/
  );
});

test('tool registry 暴露 parseDouyinVideoTool 与 LangChain tools 列表', () => {
  assert.ok(Array.isArray(toolRegistry.tools));
  assert.ok(Array.isArray(toolRegistry.langChainTools));

  assert.equal(toolRegistry.tools[0], parseDouyinVideoTool);
  assert.equal(toolRegistry.toolsByName.parse_douyin_video, parseDouyinVideoTool);
  assert.equal(toolRegistry.definitions[0], parseDouyinVideoTool.definition);
  assert.equal(toolRegistry.langChainTools[0], parseDouyinVideoTool.langChainTool);
});
