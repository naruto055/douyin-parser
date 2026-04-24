const config = require('../../config');
const { extractUrlFromText } = require('../../utils/douyinParser');

/**
 * 工具调用最大迭代次数的默认值。
 *
 * 作用：
 * - 当配置中没有提供合法上限时，作为兜底值使用。
 */
const DEFAULT_MAX_TOOL_ITERATIONS = 3;

/**
 * 解析 tool calling 运行策略，集中管理工具调用与后端降级规则。
 *
 * @param {{ userContent?: string, maxToolIterations?: number }} [options]
 * @returns {{ maxToolIterations: number, fallbackParseUrl: string }}
 */
function resolveToolCallingPolicy(options = {}) {
  /**
   * 标准化后的用户输入内容。
   *
   * `String(options.userContent || '')` 的作用：
   * - 保证后续 URL 提取逻辑始终拿到字符串。
   */
  const userContent = String(options.userContent || '');

  /**
   * 配置中的工具迭代上限。
   *
   * 来源优先级：
   * 1. 调用方传入 `options.maxToolIterations`
   * 2. 全局配置 `config.ai.maxToolIterations`
   * 3. 默认值 `DEFAULT_MAX_TOOL_ITERATIONS`
   *
   * `Number(...)` 的作用：
   * - 把配置值统一转成数值，便于后续校验。
   */
  const configuredLimit = Number(
    options.maxToolIterations || config.ai.maxToolIterations || DEFAULT_MAX_TOOL_ITERATIONS
  );

  /**
   * 从用户文本中提取出的抖音链接。
   *
   * `extractUrlFromText(userContent)` 的作用：
   * - 尝试从自由文本中提取可用于解析的 URL。
   * - 若没提取到，则回退为空字符串。
   */
  const fallbackParseUrl = extractUrlFromText(userContent) || '';

  return {
    /**
     * maxToolIterations:
     * - 当前策略下允许的最大工具调用轮次。
     *
     * `Number.isFinite(configuredLimit) && configuredLimit > 0` 的作用：
     * - 只接受正数且为有限值的配置。
     *
     * `Math.floor(configuredLimit)` 的作用：
     * - 向下取整，确保轮次数是整数。
     */
    maxToolIterations: Number.isFinite(configuredLimit) && configuredLimit > 0
      ? Math.floor(configuredLimit)
      : DEFAULT_MAX_TOOL_ITERATIONS,

    /**
     * fallbackParseUrl:
     * - 当模型未主动发起工具调用时，可供后端兜底解析的 URL。
     */
    fallbackParseUrl
  };
}

/**
 * 判断是否应触发“检测到明确抖音链接”的后端降级解析路径。
 *
 * @param {{ fallbackParseUrl?: string }} policy 运行策略
 * @param {object|null} parsedData 当前工具链解析结果
 * @returns {boolean}
 */
function shouldRunFallbackParse(policy, parsedData) {
  /**
   * `Boolean(policy?.fallbackParseUrl) && !parsedData` 的作用：
   * - 只有在用户输入里确实提取到了链接，并且当前还没有工具解析结果时，
   *   才触发后端 fallback 解析。
   */
  return Boolean(policy?.fallbackParseUrl) && !parsedData;
}

/**
 * 构造降级解析场景下附加给模型的系统提示。
 *
 * @param {object} parsedData 工具解析结果
 * @param {string} toolName 工具名称
 * @returns {{ role: string, content: string }}
 */
function buildFallbackToolResultMessage(parsedData, toolName) {
  /**
   * 构造一个 system message，把 fallback 工具结果告诉模型。
   *
   * 作用：
   * - 告诉模型“这里已经有工具执行结果了”，请直接基于结果组织用户可读回答。
   *
   * `JSON.stringify(parsedData)` 的作用：
   * - 将结构化解析结果序列化为字符串嵌入提示词中。
   */
  return {
    role: 'system',
    content: `以下是工具 ${toolName} 的执行结果，请基于它回答用户：${JSON.stringify(parsedData)}`
  };
}

module.exports = {
  DEFAULT_MAX_TOOL_ITERATIONS,
  resolveToolCallingPolicy,
  shouldRunFallbackParse,
  buildFallbackToolResultMessage
};
