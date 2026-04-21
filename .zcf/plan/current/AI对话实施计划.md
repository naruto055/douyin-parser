# 抖音解析 AI 对话功能实施计划

## Summary

目标是在现有抖音解析系统基础上新增 AI 对话能力，支持用户通过自然语言输入抖音链接或分享文案，系统自动识别解析意图、调用现有解析能力，并返回结构化结果与自然语言说明。

本期范围：
- 新增后端 AI 对话接口
- 支持 OpenAI 官方与 OpenAI 兼容模型厂商接入
- 复用现有抖音解析服务层
- 新增最小前端 AI 对话入口
- 补齐测试、文档和上线准备

TODO 状态规范：
- `[ ]` 未开始
- `[-]` 进行中
- `[x]` 已完成

## 实施任务

### 阶段 1：基础设施与配置

TODO：
- [x] 创建 `./.zcf/plan/current`
- [x] 保存计划文档到 `./.zcf/plan/current/AI对话实施计划.md`
- [x] 安装 `openai`、`zod`、`dotenv`
- [x] 扩展 AI 相关配置项：`LLM_PROVIDER`、`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`AI_CHAT_ENABLED`
- [x] 设计并固化 `/api/ai/chat` 请求与响应结构
- [x] 设计系统提示词边界，禁止模型臆造视频内容
- [x] 确定内存会话策略：最近 10 轮消息、可丢失
- [x] 明确多厂商兼容范围仅限 OpenAI 兼容协议

阶段完成说明：
- 已完成配置扩展、依赖安装和接口契约固化
- 已新增 `backend/.env.example`
- 下一阶段起始任务：实现 LLM 适配层

### 阶段 2：LLM 适配层实现

TODO：
- [x] 新建 `backend/services/llm/LLMClientFactory.js`
- [x] 新建 `backend/services/llm/OpenAICompatibleProvider.js`
- [x] 封装统一消息格式转换
- [x] 封装统一 tool schema 传入方式
- [x] 封装统一模型响应解析
- [x] 实现 provider 级错误包装
- [x] 实现模型工具调用失败时的兼容降级入口

阶段完成说明：
- 已落地 OpenAI 兼容 provider
- 已支持基于 `baseURL + model + apiKey` 切换模型厂商
- 下一阶段起始任务：实现工具层与 AI 编排层

### 阶段 3：工具层与 AI 编排层实现

TODO：
- [x] 新建 `backend/services/tools/parseDouyinVideoTool.js`
- [x] 用 `zod` 定义工具输入 schema
- [x] 工具内部直接调用 `backend/services/VideoService.js`
- [x] 新建 `backend/services/AIChatService.js`
- [x] 实现“模型首次推理 -> 工具执行 -> 二次生成”流程
- [x] 实现从用户消息中抽取抖音链接的后端降级路径
- [x] 统一输出 `reply + parsedData + sessionId`

阶段完成说明：
- 已实现工具调用主路径与后端降级路径
- 已在解析结果中保留 `shareUrl`，便于下载联动
- 下一阶段起始任务：挂载路由并补齐限流与错误处理

### 阶段 4：路由接入与错误处理

TODO：
- [x] 新建 `backend/routes/ai.js`
- [x] 在 `backend/app.js` 挂载 AI 路由
- [x] 增加 AI 接口参数校验
- [x] 增加 AI 接口统一错误输出
- [x] 增加 AI 接口限流策略
- [x] 增加 AI 链路日志，包含 provider、model、tool 使用情况

阶段完成说明：
- `/api/ai/chat` 已接入
- AI 接口使用独立限流策略
- 下一阶段起始任务：补最小前端入口

### 阶段 5：前端接入

TODO：
- [x] 新增 AI 聊天入口 UI
- [x] 接入 `/api/ai/chat`
- [x] 渲染 `reply`
- [x] 渲染 `parsedData`
- [x] 根据 `audioReady` 展示下载建议
- [x] 复用现有 `/api/download`
- [x] 补齐加载态、错误态、空态
- [x] 将 AI 回复改造为 `thinking + reply` 结构化展示

阶段完成说明：
- 已在 `backend/public/index.html` 提供最小静态联调页
- 已支持显示解析结果并联动下载
- 已支持在页面中分开展示思考过程与最终回答
- 下一阶段起始任务：增加测试覆盖

### 阶段 6：测试与验收

TODO：
- [x] 增加 provider 层单元测试
- [x] 增加 `parseDouyinVideoTool` 单元测试
- [x] 增加 `AIChatService` 单元测试
- [x] 增加 `/api/ai/chat` 路由层测试
- [x] 增加 `thinking + reply` 拆分测试
- [x] 验证缓存命中场景
- [x] 验证 OpenAI 兼容 provider 配置场景
- [ ] 验证 DeepSeek 配置场景
- [ ] 验证通义兼容配置场景
- [x] 验证工具调用失败时的后端降级场景
- [ ] 验证无效链接异常场景
- [ ] 验证超时异常场景
- [x] 验证缺少密钥异常场景

阶段完成说明：
- `pnpm test` 已通过，共 18 项测试
- 当前测试已覆盖 provider 规范化、工具层、AI 编排主路径、后端降级路径、路由层基础校验，以及缺少密钥异常场景
- DeepSeek、通义兼容配置与 AI 链路超时/无效链接场景，尚未补充专项自动化测试
- 下一阶段起始任务：更新 README 与 API 文档

### 阶段 7：文档与上线准备

TODO：
- [x] 更新后端 API 文档，新增 `/api/ai/chat`
- [x] 更新 `/api/ai/chat` 响应文档，补充 `thinking` 字段说明
- [x] 补充 AI 环境变量说明
- [x] 补充 OpenAI / DeepSeek / 通义配置示例
- [x] 补充已知限制与降级策略说明
- [x] 补充前端使用说明
- [x] 补充上线检查清单

阶段完成说明：
- README、API 文档和 `.env.example` 已更新
- 计划文档已落盘并同步 TODO 完成状态

## 上线检查清单

- [x] 已安装 AI 相关依赖
- [x] 已配置环境变量模板
- [x] 已提供独立 AI 接口文档
- [x] 已提供最小联调前端入口
- [x] 已通过自动化测试
- [ ] 待实际部署环境填写有效模型密钥
- [ ] 待联调真实 OpenAI / DeepSeek / 通义兼容接口

## 已知限制

- 当前会话状态存储在内存中，服务重启后会丢失
- 目前只支持 OpenAI 兼容 `chat.completions`
- 当前前端入口为静态联调页，不是完整独立前端工程
- AI 不会理解视频内容本身，只会基于解析元数据回复
- [x] 新增 `/api/ai/chat/stream`
- [x] 保留 `/api/ai/chat` 非流式兼容接口
- [x] 静态演示页支持 SSE 增量渲染
