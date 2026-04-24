const { tool } = require('@langchain/core/tools');

/**
 * createLangChainToolAdapter 用于把项目内部定义的“工具元数据 + 输入校验 schema + 执行函数”
 * 适配为 LangChain 可直接识别和调用的结构化工具对象。
 *
 * 主要职责：
 * 1. 校验工具定义是否完整。
 * 2. 确保工具输入 schema 是合法的 Zod schema。
 * 3. 确保工具执行器是可调用函数。
 * 4. 调用 LangChain 提供的 `tool(...)` 工厂方法生成标准工具适配器实例。
 *
 * 适用场景：
 * - 需要把业务侧工具统一适配到 LangChain agent / runtime。
 * - 希望由 LangChain 负责参数校验，而业务层只专注执行逻辑。
 *
 * 基于 zod schema 与执行函数创建 LangChain 兼容工具适配器。
 *
 * @param {{
 *  name: string,
 *  description: string,
 *  inputSchema: import('zod').ZodTypeAny,
 *  execute: (input: unknown) => Promise<unknown>
 * }} options
 * @returns {import('@langchain/core/tools').StructuredToolInterface}
 */
function createLangChainToolAdapter(options) {
  /**
   * 工具定义对象中的核心字段。
   *
   * 字段说明：
   * - name: 工具名称，供模型和运行时识别该工具。
   * - description: 工具描述，帮助模型理解该工具适合做什么。
   * - inputSchema: 输入参数的 Zod schema，用于校验工具入参结构。
   * - execute: 工具真正的业务执行函数。
   *
   * 使用解构的作用：
   * - 让后续校验和组装逻辑更直接。
   * - 避免频繁写 `options.xxx`，提升可读性。
   */
  const { name, description, inputSchema, execute } = options;

  /**
   * 校验工具名称是否合法。
   *
   * `!name || typeof name !== 'string'` 的作用：
   * - 防止 name 缺失、为空值或不是字符串。
   * - 因为 LangChain 工具必须有稳定可识别的名称，所以这里做前置保护。
   */
  if (!name || typeof name !== 'string') {
    throw new Error('Tool name is required');
  }

  /**
   * 校验输入 schema 是否为可用的 Zod schema。
   *
   * `typeof inputSchema.parse !== 'function'` 的作用：
   * - 通过检查 `parse` 方法，确认传入对象具备 Zod schema 的基本能力。
   * - 这样可以避免后续把普通对象误当作 schema 传给 LangChain。
   */
  if (!inputSchema || typeof inputSchema.parse !== 'function') {
    throw new Error(`Tool "${name}" inputSchema must be a Zod schema`);
  }

  /**
   * 校验工具执行器是否为函数。
   *
   * 作用：
   * - 确保工具在被模型调用后，确实有对应的业务逻辑可以执行。
   */
  if (typeof execute !== 'function') {
    throw new Error(`Tool "${name}" execute must be a function`);
  }

  /**
   * 调用 LangChain 的 `tool(...)` 工厂函数创建结构化工具实例。
   *
   * `tool(async (input) => execute(input), { ... })` 的作用：
   * - 把项目内部的执行函数包装为 LangChain 约定的工具形式。
   * - 把名称、描述、输入 schema 一并注册给 LangChain。
   *
   * `async (input) => execute(input)` 的作用：
   * - 适配 LangChain 对异步工具的调用方式。
   * - 收到 LangChain 传入的已校验输入后，直接转交给业务执行器处理。
   *
   * `schema: inputSchema` 的作用：
   * - 告诉 LangChain 该工具的输入结构是什么。
   * - LangChain 会基于这个 schema 对输入参数做校验和约束。
   *
   * 设计说明：
   * - 这里没有在工厂内重复手动调用 `inputSchema.parse(...)`，
   *   因为校验职责已经交给 LangChain 的 schema 机制处理，保持职责单一更清晰。
   */
  return tool(async (input) => execute(input), {
    name,
    description,
    schema: inputSchema
  });
}

module.exports = {
  createLangChainToolAdapter
};
