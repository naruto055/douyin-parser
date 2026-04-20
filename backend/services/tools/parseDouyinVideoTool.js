const { z } = require('zod');

const VideoService = require('../VideoService');

const inputSchema = z.object({
  url: z.string().trim().min(1, 'URL is required')
});

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

async function execute(input) {
  const parsed = inputSchema.parse(input);
  const result = await VideoService.parseVideo(parsed.url);
  return {
    ...result,
    shareUrl: parsed.url
  };
}

module.exports = {
  name: toolDefinition.function.name,
  definition: toolDefinition,
  inputSchema,
  execute
};
