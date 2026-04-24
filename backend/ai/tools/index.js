const parseDouyinVideoTool = require('../../services/tools/parseDouyinVideoTool');

// Phase 2 保持显式注册，避免扫描式自动加载带来的隐式复杂度。
const tools = [parseDouyinVideoTool];

const toolsByName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
const definitions = tools.map((tool) => tool.definition);
const langChainTools = tools
  .map((tool) => tool.langChainTool)
  .filter(Boolean);

module.exports = {
  tools,
  toolsByName,
  definitions,
  langChainTools
};
