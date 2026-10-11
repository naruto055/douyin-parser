# B 站视频解析前端接入计划

## 1. 需求判断

本需求属于现有解析工作台的增量功能接入，不新增独立页面，也不新增平台切换流程。

前端继续使用一个链接输入框，由后端根据链接自动识别抖音或 Bilibili。前端只消费统一的解析结果模型，并根据 `platform` 和 `bilibili` 元数据显示平台相关信息。

## 2. 当前基础

- 后端已通过 `POST /api/parse` 支持 Bilibili 普通视频页链接和 `b23.tv` 短链接。
- 后端已通过 `GET /api/download` 支持 Bilibili 视频、音频下载。
- Bilibili 视频通常是 DASH 分离的视频流和音频流，视频下载由后端使用 FFmpeg 合并为带声音的 MP4。
- 前端已经具备统一请求层、解析 API、下载 URL 构造、历史记录和结果卡片。
- 后端接口契约以 `backend/docs/API.md` 为准，本文不重复维护完整字段表。

## 3. 目标

完成前端对后端 B 站解析能力的正式消费：

1. 用户可以在现有解析工作台粘贴 B 站长链接或 `b23.tv` 短链接。
2. 前端可以正确提交并展示 B 站解析结果。
3. B 站视频和音频下载继续统一走后端下载接口。
4. 解析结果可以保存到现有本地历史记录，并从历史记录重新打开。
5. B 站专属信息与现有视觉风格保持一致，不引入新的页面风格或独立组件体系。

## 4. 设计方案

### 4.1 交互方式

- 保留当前单输入框。
- 输入框提示文案调整为“抖音或 B 站链接/分享文案”。
- 不增加平台选择器，避免用户手动选择平台与实际链接不一致。
- 提交按钮和加载状态继续使用现有组件。
- 解析失败继续使用现有统一错误状态。

### 4.2 API 分层

将当前命名为 `parseDouyin` 的前端方法调整为平台中性的解析方法，例如 `parseVideo`。

页面调用链保持不变：

```text
parser/index.vue
  -> api/parse.ts
    -> api/request.ts
      -> POST /api/parse
```

下载链路保持不变：

```text
parser/index.vue
  -> utils/download.ts / api/download.ts
    -> GET /api/download?type=...&url=...
```

不直接使用后端返回的临时 CDN 媒体地址作为用户下载链接或复制链接。

### 4.3 类型模型

在现有 `ParseResult` 基础上补充后端已提供且前端需要消费的字段：

- `platform`：`douyin` 或 `bilibili`。
- `videoMimeType`、`audioMimeType`、`audioFormat`：用于必要的资源展示或类型判断。
- `requiresMuxing`：标识 B 站视频下载需要服务端合并。
- `bilibili`：包含 `bvid`、`aid`、`cid`、`page`、`part`、`quality` 等可选元数据。

字段保持可选兼容，避免旧历史记录和旧后端响应导致页面崩溃。

### 4.4 结果展示

继续复用 `ResultCard` 和解析页现有资源卡片：

- 结果卡展示平台名称、标题、作者、封面和时长。
- B 站结果在结果信息区域补充分 P 标识、BV 号或当前清晰度等有价值信息。
- 视频资源卡继续展示编码、分辨率和格式。
- 音频资源卡继续展示音频可用状态。
- 当 `requiresMuxing` 为真时，只在必要的用户操作提示中说明视频由服务端处理，不展示后端内部实现细节。

### 4.5 历史记录

- 继续使用当前本地存储键和最多 20 条记录的策略。
- 历史记录需要保留 `platform` 和 `bilibili` 元数据。
- 按现有策略清空临时媒体 URL，历史记录重新打开后仍通过原始 `shareUrl` 触发下载。
- 下载与复制下载链接的按钮只要求原始 `shareUrl`，音频额外要求 `audioReady`；资源状态不因历史记录清空临时媒体 URL 而变为不可用。
- 历史记录去重继续以 `shareUrl` 为基础，必要时兼容规范化后的 B 站地址。

## 5. 预计改动文件

主要改动范围：

- `frontend/src/api/parse.ts`
- `frontend/src/types/parse.ts`
- `frontend/src/pages/parser/index.vue`
- `frontend/src/components/business/UrlInputCard.vue`
- `frontend/src/components/business/ResultCard.vue`
- `frontend/src/pages/history/index.vue`（仅在展示平台信息确有必要时调整）
- `frontend/src/stores/history.ts`（仅在类型或历史兼容处理需要时调整）

文档同步：

- `docs/frontend/IMPLEMENTATION_STATUS.md`
- `docs/frontend/README.md`（补充本计划文档入口）

不修改后端实现和后端接口契约，不修改现有未跟踪文件 `docs/douyin/路线与计划.md`。

## 6. 错误与兼容性

- 缺少链接时继续使用现有前端校验。
- 后端返回业务错误时继续由 `request.ts` 统一转换为 `ApiError`。
- B 站没有可用音频时，前端展示不可用状态，下载按钮保持禁用。
- H5 视频下载通过新标签页打开后端下载接口，失败时在该标签页查看后端响应；小程序端复制后端下载链接，不自行拼接临时流地址。
- 对旧历史记录缺失 `platform` 或 `bilibili` 字段的情况使用默认值和条件展示。
- 不在前端自行判断链接平台作为后端请求前置条件，避免前后端支持范围不一致。

## 7. 实施步骤与验证

1. 更新解析结果和下载相关 TypeScript 类型。
   - verify：`npm run type-check`
2. 将解析 API 和页面文案调整为平台中性，接入 B 站结果字段。
   - verify：类型检查通过，代码检索确认页面不再依赖抖音专用 API 方法名。
3. 调整结果卡片和资源卡片的 B 站信息展示，保持现有样式变量、间距和按钮规范。
   - verify：`npm run build:h5`
4. 检查历史记录兼容与下载链接构造。
   - verify：确认历史记录不保存临时媒体 URL，下载请求仍指向 `/api/download`。
5. 执行跨端构建验证。
   - verify：`npm run build:mp-weixin`、`npm run build:mp-toutiao`
6. 在后端服务可用时做最小真实联调。
   - verify：使用一个公开视频页链接和一个 `b23.tv` 短链接验证解析、结果展示、视频下载和音频下载；若环境不具备真实联调条件，需在结果中明确标注未验证。

## 8. 验收标准

- [ ] 单输入框可以提交 B 站普通视频页链接。
- [ ] 单输入框可以提交 `b23.tv` 短链接。
- [ ] B 站结果标题、作者、封面、时长和资源状态展示正常。
- [ ] B 站视频下载使用后端下载接口并得到带声音的文件。
- [ ] B 站音频可用时可以下载或复制后端下载链接。
- [ ] B 站音频不可用时按钮状态和错误提示正确。
- [ ] B 站结果可以保存、打开和清空历史记录。
- [ ] 抖音现有解析、下载和历史流程不回归。
- [x] H5、微信小程序和抖音小程序构建通过。
- [x] 不修改后端契约，不引入无明确用途的平台抽象。

### 8.1 本次验证记录（2026-10-11）

- `npm run type-check`、`npm run build:h5`、`npm run build:mp-weixin` 和 `npm run build:mp-toutiao` 均通过。
- 静态检查确认历史记录继续清空临时媒体 URL，下载按钮根据 `shareUrl` 与 `audioReady` 启用，下载请求继续使用后端 `/api/download`。
- 本次未做真实链接解析、实际文件下载或小程序手工运行；以上相关验收项仍待验证。

## 9. 暂不包含

- 不新增 B 站分 P 选择器，默认沿用后端第 1 P 行为。
- 不新增登录、Cookie、会员清晰度或字幕解析。
- 不在前端直接请求 B 站播放接口。
- 不新增 AI 解析能力。
- 不调整现有整体视觉主题或重构组件体系。
