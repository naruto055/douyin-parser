const SYSTEM_PROMPT = require('../prompts/systemPrompt');
const toolRegistry = require('../tools');
const parseDouyinVideoTool = require('../../services/tools/parseDouyinVideoTool');
const {
  resolveToolCallingPolicy,
  shouldRunFallbackParse,
  buildFallbackToolResultMessage
} = require('./toolCallingConfig');

/**
 * 创建 Chat Runtime。
 *
 * createChatRuntime 是 AI 对话执行链路中的运行时工厂。
 *
 * 主要职责：
 * 1. 组织 system prompt、历史消息、用户消息，构造成模型输入。
 * 2. 调用 provider 发起模型请求。
 * 3. 在模型触发工具调用时，负责识别、执行工具并把工具结果回填给模型。
 * 4. 在必要时执行 fallback 解析逻辑，兜底补充抖音解析数据。
 * 5. 同时支持普通模式和流式模式两种执行方式。
 *
 * 当前运行时不再依赖 LangChain agent executor，而是直接通过 provider.generate /
 * provider.streamGenerate 执行 tool calling 编排：
 * 1. 首次请求携带工具定义，让模型决定是否触发工具调用；
 * 2. 服务端手动执行本地工具；
 * 3. 将工具结果回填给模型生成最终回复。
 *
 * @param {{
 *  provider: { generate?: Function, streamGenerate?: Function },
 *  systemPrompt?: string,
 *  registry?: { definitions?: Array, toolsByName?: object },
 *  parseTool?: { name: string, execute: Function }
 * }} options
 * @returns {{ run: Function, runStream: Function }}
 */
function createChatRuntime(options = {}) {
  /**
   * 当前运行时使用的大模型提供者。
   *
   * 作用：
   * - 提供普通生成能力 `generate()`。
   * - 如果支持，还可以提供流式生成能力 `streamGenerate()`。
   */
  const provider = options.provider;

  /**
   * 当前运行时使用的系统提示词。
   *
   * 作用：
   * - 作为整个对话链路的行为约束和角色设定。
   * - 如果调用方没有传入，则回退到默认系统提示词。
   */
  const systemPrompt = options.systemPrompt || SYSTEM_PROMPT;

  /**
   * 工具注册表。
   *
   * 结构通常包含：
   * - definitions: 提供给模型的工具定义列表。
   * - toolsByName: 通过工具名查找本地执行器的映射表。
   */
  const registry = options.registry || toolRegistry;

  /**
   * 抖音解析工具。
   *
   * 作用：
   * - 作为普通工具调用的一部分被执行。
   * - 在模型没有主动触发时，也可能作为 fallback 工具被兜底调用。
   */
  const parseTool = options.parseTool || parseDouyinVideoTool;

  /**
   * 校验 provider 是否具备最基本的生成能力。
   *
   * `typeof provider.generate !== 'function'` 的作用：
   * - 确保运行时至少能执行非流式生成。
   * - 没有这个能力，整个运行时无法工作，因此直接失败。
   */
  if (!provider || typeof provider.generate !== 'function') {
    throw new Error('Chat runtime requires a provider with generate()');
  }

  return {
    async run(input) {
      /**
       * 历史消息数组。
       *
       * `Array.isArray(input?.history) ? input.history : []` 的作用：
       * - 只有当 history 确实是数组时才使用。
       * - 否则回退为空数组，避免后续消息拼接出错。
       */
      const history = Array.isArray(input?.history) ? input.history : [];

      /**
       * 当前轮用户消息对象。
       */
      const userMessage = input?.userMessage;

      /**
       * 工具调用策略。
       *
       * `resolveToolCallingPolicy(...)` 的作用：
       * - 根据用户输入内容决定本轮是否存在 fallback 解析需求。
       * - 把工具调用策略从运行逻辑中抽离出来，便于集中维护。
       */
      const policy = resolveToolCallingPolicy({
        userContent: userMessage?.content
      });

      /**
       * 发给模型的基础消息列表。
       *
       * `buildBaseMessages(...)` 的作用：
       * - 统一把 system prompt、历史消息、当前用户消息拼成标准消息序列。
       */
      const baseMessages = buildBaseMessages(systemPrompt, history, userMessage);

      /**
       * 执行一轮完整的“模型判断 -> 工具调用 -> 最终回复”流程。
       *
       * `runToolCallingRound(...)` 的作用：
       * - 先请求模型。
       * - 如果模型发起了工具调用，则执行本地工具。
       * - 再把工具结果回填给模型生成最终回复。
       */
      const runtimeResult = await runToolCallingRound({
        provider,
        messages: baseMessages,
        registry,
        parseTool
      });

      /**
       * 判断是否需要执行 fallback 抖音解析。
       *
       * `shouldRunFallbackParse(policy, runtimeResult.parsedData)` 的作用：
       * - 当模型没有正常触发工具，但策略判断当前输入很可能需要解析链接时，执行兜底解析。
       */
      if (shouldRunFallbackParse(policy, runtimeResult.parsedData)) {
        /**
         * 直接执行本地抖音解析工具。
         *
         * `parseTool.execute({ url: policy.fallbackParseUrl })` 的作用：
         * - 使用策略中提取出的链接做一次服务端主动解析。
         */
        const parsedData = await parseTool.execute({ url: policy.fallbackParseUrl });

        /**
         * 基于 fallback 工具结果再次请求模型生成最终回复。
         *
         * `buildFallbackToolResultMessage(...)` 的作用：
         * - 把兜底解析结果包装成模型可理解的工具结果消息。
         */
        const fallbackResponse = await provider.generate({
          messages: [
            ...baseMessages,
            buildFallbackToolResultMessage(parsedData, parseTool.name)
          ]
        });

        return {
          content: fallbackResponse.content || '',
          parsedData
        };
      }

      /**
       * 如果既没有文本回复，也没有工具结果，则认为运行时异常结束。
       */
      if (!runtimeResult.content && !runtimeResult.parsedData) {
        throw buildRuntimeTerminationError();
      }

      return {
        content: runtimeResult.content || '',
        parsedData: runtimeResult.parsedData
      };
    },

    async runStream(input) {
      /**
       * 历史消息数组。
       */
      const history = Array.isArray(input?.history) ? input.history : [];

      /**
       * 当前轮用户消息。
       */
      const userMessage = input?.userMessage;

      /**
       * 运行时事件发送函数。
       *
       * `input?.onRuntimeEvent` 的作用：
       * - 允许调用方监听模型开始、文本增量、工具结果等事件。
       * - 若未提供，则使用空函数避免频繁判空。
       */
      const emitRuntimeEvent =
        typeof input?.onRuntimeEvent === 'function'
          ? input.onRuntimeEvent
          : () => {};

      /**
       * 工具调用策略。
       */
      const policy = resolveToolCallingPolicy({
        userContent: userMessage?.content
      });

      /**
       * 流式模式下同样复用基础消息构建逻辑。
       */
      const baseMessages = buildBaseMessages(systemPrompt, history, userMessage);

      /**
       * 先发出“模型开始分析”事件。
       *
       * 作用：
       * - 让上层可以尽早感知流式过程已经开始，而不是一直等待首个内容片段。
       */
      emitRuntimeEvent({
        type: 'progress',
        stage: 'model_start',
        message: 'AI 正在分析输入'
      });

      /**
       * 最终累计的文本内容。
       */
      let content = '';

      /**
       * 工具执行后的结构化数据。
       */
      let parsedData = null;

      /**
       * 在流式过程中捕获到的工具调用信息。
       *
       * 说明：
       * - 有些 provider 的流式输出会单独推送 tool_call 事件。
       */
      let streamedToolCall = null;

      /**
       * 当 provider 支持流式生成时，优先走真正的流式路径。
       */
      if (typeof provider.streamGenerate === 'function') {
        /**
         * `for await ... of provider.streamGenerate(...)` 的作用：
         * - 逐个消费 provider 产生的异步事件流。
         * - 适合接收文本增量、工具调用等实时事件。
         */
        for await (const event of provider.streamGenerate({
          messages: baseMessages,
          tools: getProviderTools(registry),
          toolChoice: 'auto'
        })) {
          /**
           * 过滤掉空值或非对象事件，避免后续访问字段时报错。
           */
          if (!event || typeof event !== 'object') {
            continue;
          }

          /**
           * 处理文本增量事件。
           *
           * `content += event.delta` 的作用：
           * - 把每次收到的文本片段顺序拼接成完整回复。
           *
           * `emitRuntimeEvent(event)` 的作用：
           * - 原样把内容增量转发给上层消费。
           */
          if (event.type === 'content_delta' && event.delta) {
            content += event.delta;
            emitRuntimeEvent(event);
            continue;
          }

          /**
           * 处理工具调用事件。
           *
           * 作用：
           * - 先记录下来，等流式首轮完成后再统一执行本地工具。
           */
          if (event.type === 'tool_call' && event.toolCall) {
            streamedToolCall = event.toolCall;
          }
        }
      }

      /**
       * 如果流式阶段检测到了工具调用，则执行工具并回填给模型生成最终文本。
       */
      if (streamedToolCall) {
        /**
         * `executeToolCall(...)` 的作用：
         * - 根据工具名找到本地工具。
         * - 解析工具参数。
         * - 实际执行工具并返回结构化结果。
         */
        const toolExecution = await executeToolCall(streamedToolCall, { registry, parseTool });
        if (toolExecution) {
          parsedData = toolExecution.parsedData;

          /**
           * 向上层发送工具执行结果事件。
           */
          emitRuntimeEvent({
            type: 'tool_result',
            parsedData
          });

          /**
           * 把工具结果作为 tool message 回填给模型，请模型继续生成最终回复。
           */
          const finalResponse = await provider.generate({
            messages: [
              ...baseMessages,
              buildAssistantToolCallMessage(toolExecution.toolCall),
              buildToolResultMessage(toolExecution.toolName, parsedData, toolExecution.toolCallId)
            ]
          });

          /**
           * 如果模型返回了最终文本，则拼接到 content 并转发增量事件。
           */
          if (finalResponse.content) {
            content += finalResponse.content;
            emitRuntimeEvent({
              type: 'content_delta',
              delta: finalResponse.content
            });
          }
        }
      /**
       * 如果没有收到任何流式工具调用，且也没有流式文本输出，
       * 则回退到非流式的一轮工具编排逻辑，作为兼容兜底。
       */
      } else if (!content) {
        const runtimeResult = await runToolCallingRound({
          provider,
          messages: baseMessages,
          registry,
          parseTool
        });

        content = runtimeResult.content || '';
        parsedData = runtimeResult.parsedData;

        /**
         * 把兜底路径中的工具结果和内容同样转成流式事件向外发送，
         * 让调用方保持统一消费方式。
         */
        if (parsedData) {
          emitRuntimeEvent({
            type: 'tool_result',
            parsedData
          });
        }

        if (content) {
          emitRuntimeEvent({
            type: 'content_delta',
            delta: content
          });
        }
      }

      /**
       * 流式模式下同样支持 fallback 解析策略。
       */
      if (shouldRunFallbackParse(policy, parsedData)) {
        parsedData = await parseTool.execute({ url: policy.fallbackParseUrl });
        emitRuntimeEvent({
          type: 'tool_result',
          parsedData
        });

        const fallbackResponse = await provider.generate({
          messages: [
            ...baseMessages,
            buildFallbackToolResultMessage(parsedData, parseTool.name)
          ]
        });
        content = fallbackResponse.content || '';

        if (content) {
          emitRuntimeEvent({
            type: 'content_delta',
            delta: content
          });
        }
      }

      /**
       * 如果最终既没有文本也没有解析结果，说明运行时未生成有效输出。
       */
      if (!content && !parsedData) {
        throw buildRuntimeTerminationError();
      }

      return {
        content: content || '',
        parsedData
      };
    }
  };
}

/**
 * 构建发给模型的基础消息列表。
 *
 * 作用：
 * - 固定以 system prompt 开头。
 * - 依次拼接历史消息和当前用户消息。
 * - 统一普通模式和流式模式的消息组织方式。
 *
 * @param {string} systemPrompt 系统提示词
 * @param {Array} history 历史消息
 * @param {object} userMessage 当前用户消息
 * @returns {Array}
 */
function buildBaseMessages(systemPrompt, history, userMessage) {
  return [
    { role: 'system', content: systemPrompt },
    ...history,
    userMessage
  ];
}

/**
 * 执行一轮标准工具调用流程。
 *
 * 流程：
 * 1. 先请求模型。
 * 2. 检查模型是否请求调用工具。
 * 3. 若有工具调用，则执行本地工具。
 * 4. 将工具结果作为 tool message 回填给模型，请其生成最终回复。
 *
 * @param {{ provider: object, messages: Array, registry: object, parseTool: object }} params
 * @returns {Promise<{ content: string, parsedData: object|null }>}
 */
async function runToolCallingRound({ provider, messages, registry, parseTool }) {
  /**
   * 首次模型响应。
   *
   * `tools: getProviderTools(registry)` 的作用：
   * - 把可供模型调用的工具定义告诉 provider。
   *
   * `toolChoice: 'auto'` 的作用：
   * - 允许模型自行决定是否需要调用工具。
   */
  const initialResponse = await provider.generate({
    messages,
    tools: getProviderTools(registry),
    toolChoice: 'auto'
  });

  /**
   * 查找并执行模型请求的第一个可用工具调用。
   *
   * `findAndExecuteToolCall(...)` 的作用：
   * - 遍历模型返回的 toolCalls。
   * - 找到本地可执行且参数合法的工具并执行。
   */
  const toolExecution = await findAndExecuteToolCall(initialResponse?.toolCalls, {
    registry,
    parseTool
  });

  /**
   * 如果模型没有触发可执行的工具，则直接返回首次响应内容。
   */
  if (!toolExecution) {
    return {
      content: initialResponse?.content || '',
      parsedData: null
    };
  }

  /**
   * 把工具结果回填给模型，生成最终面向用户的自然语言回复。
   */
  const finalResponse = await provider.generate({
    messages: [
      ...messages,
      buildAssistantToolCallMessage(toolExecution.toolCall),
      buildToolResultMessage(
        toolExecution.toolName,
        toolExecution.parsedData,
        toolExecution.toolCallId
      )
    ]
  });

  return {
    content: finalResponse?.content || '',
    parsedData: toolExecution.parsedData
  };
}

/**
 * 获取传给 provider 的工具定义列表。
 *
 * @param {object} registry 工具注册表
 * @returns {Array}
 */
function getProviderTools(registry) {
  return Array.isArray(registry?.definitions) ? registry.definitions : [];
}

/**
 * 从模型返回的多个工具调用中，找到并执行第一个有效工具。
 *
 * @param {Array|undefined} toolCalls 模型返回的工具调用列表
 * @param {{ registry: object, parseTool: object }} deps
 * @returns {Promise<{ toolName: string, parsedData: object }|null>}
 */
async function findAndExecuteToolCall(toolCalls, { registry, parseTool }) {
  /**
   * 规范化后的工具调用数组。
   *
   * 作用：
   * - 保证后续 `for ... of` 一定可安全遍历。
   */
  const normalizedToolCalls = Array.isArray(toolCalls) ? toolCalls : [];

  for (const toolCall of normalizedToolCalls) {
    /**
     * 尝试执行单个工具调用。
     * 一旦成功，立即返回，避免重复执行多个工具导致结果歧义。
     */
    const execution = await executeToolCall(toolCall, { registry, parseTool });
    if (execution) {
      return execution;
    }
  }

  return null;
}

/**
 * 执行单个工具调用。
 *
 * @param {object} toolCall 模型返回的单个工具调用描述
 * @param {{ registry: object, parseTool: object }} deps
 * @returns {Promise<{ toolName: string, parsedData: object }|null>}
 */
async function executeToolCall(toolCall, { registry, parseTool }) {
  /**
   * 标准化后的工具名称。
   *
   * `String(toolCall?.name || '').trim()` 的作用：
   * - 保证工具名始终按字符串处理。
   * - 去掉首尾空白，降低输入噪声影响。
   */
  const toolName = String(toolCall?.name || '').trim();
  if (!toolName) {
    return null;
  }

  /**
   * 根据工具名查找本地可执行工具。
   *
   * 查找顺序：
   * 1. 优先从注册表 `toolsByName` 中查找。
   * 2. 如果名称与 parseTool 匹配，则使用传入的解析工具。
   */
  const tool = registry?.toolsByName?.[toolName] || (parseTool?.name === toolName ? parseTool : null);

  /**
   * 若工具不存在，或没有 execute 方法，则无法执行。
   */
  if (!tool || typeof tool.execute !== 'function') {
    return null;
  }

  /**
   * 解析模型返回的工具参数。
   *
   * `parseToolCallArguments(...)` 的作用：
   * - 支持对象形式参数。
   * - 也支持 JSON 字符串形式参数。
   */
  const parsedArguments = parseToolCallArguments(toolCall?.arguments);
  if (!parsedArguments) {
    return null;
  }

  /**
   * 执行工具并拿到结构化结果。
   */
  const parsedData = await tool.execute(parsedArguments);
  return {
    toolName,
    toolCall,
    toolCallId: toolCall.id,
    parsedData
  };
}

/**
 * 构建 assistant tool_call 消息。
 *
 * 作用：
 * - 在把 tool 结果回填给模型前，先补上一条 assistant 发起工具调用的消息。
 * - 保持与 OpenAI tool calling 协议一致，避免孤立的 tool message 被接口拒绝。
 *
 * @param {{ id?: string, type?: string, name?: string, arguments?: string|object }} toolCall
 * @returns {{ role: string, content: string, tool_calls: Array }}
 */
function buildAssistantToolCallMessage(toolCall) {
  return {
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        id: toolCall?.id,
        type: toolCall?.type || 'function',
        function: {
          name: toolCall?.name || '',
          arguments: normalizeAssistantToolArguments(toolCall?.arguments)
        }
      }
    ]
  };
}

/**
 * 解析工具调用参数。
 *
 * 支持两种输入：
 * - 已经是对象的参数。
 * - JSON 字符串形式的参数。
 *
 * @param {unknown} rawArguments 原始工具参数
 * @returns {object|null}
 */
function parseToolCallArguments(rawArguments) {
  /**
   * 如果本身就是普通对象，则直接返回。
   */
  if (rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)) {
    return rawArguments;
  }

  /**
   * 如果不是非空字符串，则无法按 JSON 解析。
   */
  if (typeof rawArguments !== 'string' || !rawArguments.trim()) {
    return null;
  }

  try {
    /**
     * `JSON.parse(rawArguments)` 的作用：
     * - 把模型返回的 JSON 字符串参数解析成对象。
     */
    const parsed = JSON.parse(rawArguments);

    /**
     * 只接受普通对象，过滤 null、数组等不符合预期的结构。
     */
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    /**
     * 解析失败时返回 null，而不是抛错中断整体流程。
     * 这样运行时可以把该工具调用视为无效并继续兜底处理。
     */
    return null;
  }
}

/**
 * 构建标准 tool message。
 *
 * 作用：
 * - 把本地工具执行结果包装成模型可消费的消息格式。
 *
 * @param {string} toolName 工具名称
 * @param {object} parsedData 工具执行结果
 * @param {string} [toolCallId] 工具调用 ID
 * @returns {{ role: string, name: string, content: string, tool_call_id?: string }}
 */
function buildToolResultMessage(toolName, parsedData, toolCallId) {
  const message = {
    role: 'tool',
    name: toolName,
    content: JSON.stringify(parsedData)
  };

  if (toolCallId) {
    message.tool_call_id = toolCallId;
  }

  return message;
}

/**
 * 规范化 assistant tool_call 中的 arguments 字段。
 *
 * @param {unknown} rawArguments
 * @returns {string}
 */
function normalizeAssistantToolArguments(rawArguments) {
  if (typeof rawArguments === 'string') {
    return rawArguments;
  }

  if (rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)) {
    return JSON.stringify(rawArguments);
  }

  return '{}';
}

/**
 * 构建运行时异常结束错误。
 *
 * 作用：
 * - 当模型既没有文本输出，也没有工具结果时，统一抛出一个带状态码的错误。
 *
 * @returns {Error}
 */
function buildRuntimeTerminationError() {
  const error = new Error('AI runtime ended without a valid reply');
  error.statusCode = 502;
  return error;
}

module.exports = createChatRuntime;
