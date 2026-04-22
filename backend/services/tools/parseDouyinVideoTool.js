const { z } = require('zod');

const VideoService = require('../VideoService');

/**
 * 抖音视频解析工具，供 LLM 通过 Tool Calling / Function Calling 机制间接调用。
 *
 * 工作流程：
 * 1. AIChatService 在构造模型请求时，将本文件导出的 `definition` 放入 `tools` 数组传给 LLM。
 * 2. 模型判断用户问题需要解析抖音链接时，会返回一个 `tool_call`，其中包含工具名 `parse_douyin_video`
 *    和结构化参数。
 * 3. OpenAICompatibleProvider 会把模型返回的 `tool_call` 归一化为 `toolCalls`，再交给
 *    AIChatService._executeToolCalls() 统一调度。
 * 4. AIChatService 根据工具名匹配到本文件，并调用 `execute(input)` 真正执行服务端逻辑。
 * 5. `execute(input)` 先使用 `inputSchema` 校验参数，再调用 VideoService.parseVideo() 获取解析结果。
 * 6. 工具执行结果会被包装成 `role: 'tool'` 的消息回填给模型，模型再基于真实结果生成最终回复。
 *
 * 使用约定：
 * - `definition`：给模型看的工具说明书，描述工具名称、用途和参数结构。
 * - `inputSchema`：给服务端做参数校验，避免模型传入错误参数时直接污染业务逻辑。
 * - `execute(input)`：真正执行工具逻辑的入口，保持“薄工具层”设计，只做校验、调用服务、整理返回值。
 *
 * 设计原则：
 * - 工具层不直接依赖 HTTP 请求上下文，只处理结构化输入与结构化输出。
 * - 工具名、参数结构、返回字段应尽量稳定，避免影响模型提示词和工具调度链路。
 * - 复杂业务应下沉到 Service 层，本文件只负责适配 Tool Calling 协议。
 */

// 定义工具入参结构，确保调用方至少传入一个非空 URL 文本。
const inputSchema = z.object({
  url: z.string().trim().min(1, 'URL is required')
});

// 按 OpenAI Tool Calling 规范声明工具元信息，供模型识别可调用能力。
const toolDefinition = {
  type: 'function',
  function: {
    name: 'parse_douyin_video',
    description: '解析抖音分享链接或分享文案，返回标题、作者、封面、视频地址和音频地址等元数据。',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '抖音分享链接或包含抖音链接的文案'
        }
      },
      required: ['url'],
      additionalProperties: false
    }
  }
};

/**
 * 执行抖音视频解析工具。
 *
 * @param {{url: string}} input 工具输入参数
 * @returns {Promise<object>} 解析后的抖音视频信息
 */
async function execute(input) {
  // 先通过 schema 做统一校验，避免将非法参数传入业务层。
  const parsed = inputSchema.parse(input);

  // 复用视频服务完成实际解析逻辑，工具层只负责参数适配与结果封装。
  const result = await VideoService.parseVideo(parsed.url);

  return {
    ...result,
    // 保留调用方原始分享链接，便于上游展示或追踪来源。
    shareUrl: parsed.url
  };
}

module.exports = {
  name: toolDefinition.function.name,
  definition: toolDefinition,
  inputSchema,
  execute
};
