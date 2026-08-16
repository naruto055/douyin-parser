# 抖音解析器 API 文档

## 概述

抖音解析器后端提供 RESTful API，用于解析抖音视频链接并下载视频/音频内容。

**基础地址**: `http://localhost:3000`

**内容类型**:

- 普通接口默认返回 `application/json`
- 下载接口成功时返回文件流
- SSE 流式接口返回 `text/event-stream`

---

## 通用说明

### 速率限制

- 普通解析接口：每分钟 20 次请求
- AI 对话接口 `POST /api/ai/chat`、`POST /api/ai/chat/stream`：每分钟 10 次请求
- 健康检查接口 `GET /api/health` 不走普通 `/api` 限流
- 超出限制返回：429 Too Many Requests

### 统一响应格式

普通 JSON 接口统一返回以下结构：

**成功响应**:
```json
{
  "code": 200,
  "message": "success",
  "data": {}
}
```

**失败响应**:
```json
{
  "code": 400,
  "message": "错误描述信息",
  "data": null
}
```

字段说明：

- `code`：数字响应码，成功时为 `200`，失败时尽量与 HTTP 状态语义保持一致。
- `message`：面向调用方的简要说明。
- `data`：业务数据；失败时通常为 `null`。

业务可预期失败返回 HTTP 200，并通过非 `200` 的 `code` 表达失败原因。参数错误、限流、未知系统异常等非业务异常保留对应 HTTP 状态码。

文件下载接口和 SSE 流式接口不强制包装为普通 JSON 响应；其中 `/api/ai/chat/stream` 在 SSE 建立前的参数错误仍返回统一 JSON。

### 错误码

| code | 常量 | HTTP 状态码 | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| `200` | `OK` | 200 | 成功 | 请求成功 |
| `400` | `VALIDATION_ERROR` | 400 | 非业务异常 | 参数错误 |
| `500` | `PARSE_FAILED` | 200 | 业务异常 | 视频解析失败 |
| `500` | `VIDEO_UNAVAILABLE` | 200 | 业务异常 | 视频资源不可用 |
| `500` | `DOWNLOAD_RESOURCE_MISSING` | 200 | 业务异常 | 下载资源缺失 |
| `500` | `AI_CHAT_FAILED` | 200 | 业务异常 | AI 对话业务失败 |
| `429` | `RATE_LIMITED` | 429 | 非业务异常 | 请求过于频繁 |
| `500` | `INTERNAL_ERROR` | 500 | 非业务异常 | 未知系统异常 |
---

## API 接口

### 1. 健康检查

检查服务是否正常运行。

**请求**:
```
GET /api/health
```

**响应示例**:
```json
{
  "code": 200,
  "message": "Service is running",
  "data": {
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
}
```

---

### 2. 解析抖音链接

解析抖音视频 URL，获取视频信息（标题、作者、封面、视频链接、音频链接等）。

**请求**:
```
POST /api/parse
Content-Type: application/json

{
  "url": "https://v.douyin.com/xxxxx/"
}
```

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | 抖音视频链接（支持短链接） |

**响应示例**:
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "source": "puppeteer",
    "title": "视频标题",
    "author": "作者昵称",
    "cover": "https://.../cover.jpg",
    "duration": 15000,
    "videoUrl": "https://.../video.mp4",
    "videoBackupUrls": ["https://.../video.mp4"],
    "videoCodec": "h264",
    "videoFormat": "mp4",
    "videoWidth": 1080,
    "videoHeight": 1920,
    "videoBitRate": 1944887,
    "videoSource": "play_addr_h264",
    "videoExpiresAt": 1786082767,
    "video265Url": "https://.../video-h265.mp4",
    "audioUrl": "https://.../audio.mp3",
    "audioBackupUrls": ["https://.../audio.mp3"],
    "audioType": "music",
    "audioReady": true
  }
}
```

**响应字段说明**:
| 字段 | 类型 | 说明 |
|------|------|------|
| source | string | 数据来源：`http_detail`、`puppeteer` 或第三方 API（如 `xinyew`、`jxcxin`、`devtool`） |
| title | string | 视频标题 |
| author | string | 作者昵称 |
| cover | string | 封面图片 URL |
| duration | number | 视频时长（毫秒） |
| videoUrl | string | 默认兼容的视频下载链接，优先 H.264 MP4 |
| videoBackupUrls | string[] | 视频备用下载链接（可选） |
| videoCodec | string | 视频编码，例如 `h264`、`h265`（可选） |
| videoFormat | string | 视频格式，例如 `mp4`（可选） |
| videoWidth | number | 视频宽度（可选） |
| videoHeight | number | 视频高度（可选） |
| videoBitRate | number | 视频码率（可选） |
| videoSource | string | 视频来源字段，例如 `play_addr_h264`、`play_addr`、`bit_rate`（可选） |
| videoExpiresAt | number | 视频 CDN URL 过期时间，Unix 秒（可选） |
| videoWatermarkRisk | boolean | 视频来源可能带水印时返回 `true`（可选） |
| video265Url | string | H.265 候选视频链接；默认不作为 `videoUrl`，调用方确认支持 H.265 后再使用（可选） |
| video265BackupUrls | string[] | H.265 备用链接（可选） |
| video265Codec | string | H.265 候选编码，通常为 `h265`（可选） |
| audioUrl | string | 音乐/BGM 音频链接（可选） |
| audioBackupUrls | string[] | 音乐/BGM 备用链接（可选） |
| audioType | string | 音频语义类型，当前为 `music` 表示作品音乐/BGM（可选） |
| audioTitle | string | 音乐/BGM 标题（可选） |
| audioAuthor | string | 音乐/BGM 作者（可选） |
| audioReady | boolean | 是否有可用的音乐/BGM 音频 |
| fallbackReason | string | Puppeteer 失败后进入第三方 API 兜底的原因（可选） |

**错误响应**:
```json
{
  "code": 400,
  "message": "URL is required",
  "data": null
}
```

---

### 3. 下载视频/音频

下载视频或提取音频。直接传入抖音分享链接，接口会自动解析并下载。已解析过的视频会从缓存获取，无需重复解析。

**请求**:
```
GET /api/download?type=video&url=https://v.douyin.com/xxxxx/
GET /api/download?type=audio&url=https://v.douyin.com/xxxxx/
```

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 是 | 下载类型：`video` 或 `audio` |
| url | string | 是 | 抖音视频分享链接（支持短链接） |
| title | string | 否 | 文件名（不含扩展名），默认使用视频标题 |

**注意**: 接口只接受抖音页面 URL，不接受直接的媒体文件链接（如 .mp3、.mp4 等）。

#### 缓存机制

- 解析结果基于**视频 ID** 进行缓存
- 缓存有效期：默认 1 小时（可配置），且不会超过视频 CDN URL 过期时间；过近过期的结果不写入缓存
- 相同视频重复下载时，直接从缓存获取解析结果，无需重新解析

#### 响应

- 成功：返回文件流（`video/mp4` 或 `audio/mpeg`）
- 失败：返回 JSON 错误信息

**错误响应示例**:
```json
{
  "code": 400,
  "message": "type and url are required",
  "data": null
}
```

**其他常见错误**:

```json
{
  "code": 400,
  "message": "Invalid URL type. Please provide a Douyin video page URL, not a direct media file URL.",
  "data": null
}
```

```json
{
  "code": 400,
  "message": "Invalid type. Must be \"audio\" or \"video\"",
  "data": null
}
```

---

### 4. AI 对话解析

通过自然语言与 AI 交互，自动识别消息中的抖音链接或分享文案，并调用解析能力返回结果。

**请求**:
```http
POST /api/ai/chat
Content-Type: application/json

{
  "message": "帮我解析这个抖音链接 https://v.douyin.com/xxxxx/",
  "sessionId": "optional-session-id"
}
```

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | 是 | 用户输入的自然语言消息，可包含抖音链接或分享文案 |
| sessionId | string | 否 | 会话 ID，不传时由后端生成 |

**响应示例**:
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "thinking": "用户提供了有效抖音链接，我先基于工具结果整理结构化信息，再给出简短说明。",
    "reply": "解析成功，这个视频的标题是示例标题，作者是示例作者。",
    "sessionId": "f4df1d0b-cb2b-49ca-bfe3-7262d5e9ec67",
    "toolStatus": {
      "status": "resolved",
      "warnings": []
    },
    "parsedData": {
      "source": "puppeteer",
      "title": "示例标题",
      "author": "示例作者",
      "cover": "https://.../cover.jpg",
      "duration": 15000,
      "videoUrl": "https://.../video.mp4",
      "audioUrl": "https://.../audio.mp3",
      "audioReady": true,
      "shareUrl": "https://v.douyin.com/xxxxx/"
    }
  }
}
```

**响应字段说明**:
| 字段 | 类型 | 说明 |
|------|------|------|
| thinking | string | 模型思考过程；无思考内容时返回空字符串 |
| reply | string | AI 的最终自然语言回复，已剥离 `<think>...</think>` 思考内容 |
| sessionId | string | 会话 ID，用于连续对话 |
| toolStatus | object \| null | 解析工具结果的确定性状态；未触发解析时返回 `null` |
| toolStatus.status | string | 当前支持 `resolved`、`suspect` |
| toolStatus.warnings | string[] | 状态告警码列表，例如 `placeholder_share_url` |
| parsedData | object \| null | 当消息触发了解析时返回结构化解析结果 |
| parsedData.shareUrl | string | 原始分享链接，便于前端复用下载接口 |

**行为说明**:
- 默认走 OpenAI 兼容 `chat.completions`
- 当模型未稳定触发工具调用时，后端会尝试从消息中提取抖音链接并直接执行解析
- AI 不会臆造视频内容，只会基于工具结果回复
- `toolStatus` 表示工具结果的可信度判断，不等价于模型最终业务结论

**错误响应示例**:
```json
{
  "code": 500,
  "message": "LLM API key is not configured",
  "data": null
}
```

---

### 5. AI 流式对话解析

通过 SSE 按事件流返回 AI 对话过程，适合前端渐进展示思考过程、解析进度和最终回答。

**请求**:
```http
POST /api/ai/chat/stream
Accept: text/event-stream
Content-Type: application/json

{
  "message": "帮我解析这个抖音链接 https://v.douyin.com/xxxxx/",
  "sessionId": "optional-session-id"
}
```

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | 是 | 用户输入的自然语言消息，可包含抖音链接或分享文案 |
| sessionId | string | 否 | 会话 ID，不传时由后端生成 |

**响应头**:
```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
```

**事件顺序**:
- `session`：返回本次会话 ID
- `progress`：返回当前处理阶段文案
- `thinking_delta`：返回思考内容增量
- `reply_delta`：返回最终回答增量
- `tool_result`：返回完整解析结果对象与状态元信息
- `done`：返回最终完整结果，结构与 `/api/ai/chat` 的 `data` 一致
- `error`：流式过程中出现错误时返回

**事件示例**:
```text
event: session
data: {"sessionId":"f4df1d0b-cb2b-49ca-bfe3-7262d5e9ec67"}

event: progress
data: {"stage":"model_start","message":"AI 正在分析输入"}

event: tool_result
data: {"toolStatus":{"status":"resolved","warnings":[]},"parsedData":{"title":"示例标题","author":"示例作者","shareUrl":"https://v.douyin.com/xxxxx/","audioReady":true}}

event: reply_delta
data: {"delta":"解析成功，标题是示例标题。"}

event: done
data: {"thinking":"...","reply":"解析成功，标题是示例标题。","sessionId":"f4df1d0b-cb2b-49ca-bfe3-7262d5e9ec67","toolStatus":{"status":"resolved","warnings":[]},"parsedData":{"title":"示例标题","author":"示例作者","shareUrl":"https://v.douyin.com/xxxxx/","audioReady":true}}
```

**兼容说明**:
- 保留原有 `POST /api/ai/chat` 非流式接口，便于旧调用方继续使用
- 推荐浏览器端使用 `fetch + ReadableStream` 消费流式响应，因为原生 `EventSource` 不支持 `POST` 请求体
- 若模型侧暂未返回稳定的 token 流，服务端仍会保证 `session`、`progress`、`done` 等关键事件存在
- `tool_result` 代表工具已经返回结构化对象，不直接等价于“链接业务有效”；请结合 `toolStatus` 判断是否需要提示用户二次确认

---


## 使用示例

### cURL 示例

**健康检查**:
```bash
curl http://localhost:3000/api/health
```

**解析视频**:
```bash
curl -X POST http://localhost:3000/api/parse \
  -H "Content-Type: application/json" \
  -d '{"url": "https://v.douyin.com/xxxxx/"}'
```

**AI 对话解析**:
```bash
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"帮我解析这个抖音链接 https://v.douyin.com/xxxxx/"}'
```

**AI 流式对话解析**:
```bash
curl -N -X POST http://localhost:3000/api/ai/chat/stream \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"message":"帮我解析这个抖音链接 https://v.douyin.com/xxxxx/"}'
```

**下载视频（简化调用）**:
```bash
curl -o video.mp4 "http://localhost:3000/api/download?type=video&url=https://v.douyin.com/xxxxx/"
```

**下载音频（简化调用）**:
```bash
curl -o audio.mp3 "http://localhost:3000/api/download?type=audio&url=https://v.douyin.com/xxxxx/"
```

### JavaScript 示例

```javascript
// 解析视频
async function parseVideo(url) {
  const response = await fetch('http://localhost:3000/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  return await response.json();
}

// 下载视频
function downloadVideo(shareUrl, title) {
  const url = `http://localhost:3000/api/download?type=video&url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(title || 'video')}`;
  window.location.href = url;
}

// 下载音频
function downloadAudio(shareUrl, title) {
  const url = `http://localhost:3000/api/download?type=audio&url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(title || 'audio')}`;
  window.location.href = url;
}

// 完整流程：解析后下载（适合需要展示视频信息的场景）
async function parseAndDownload(shareUrl) {
  // 1. 解析获取视频信息
  const result = await parseVideo(shareUrl);
  if (result.code !== 200) {
    console.error('解析失败:', result.message, result.code);
    return;
  }

  // 2. 展示视频信息
  console.log('标题:', result.data.title);
  console.log('作者:', result.data.author);

  // 3. 下载视频（接口会自动使用缓存，无需重新解析）
  downloadVideo(shareUrl, result.data.title);
}
```

---

## 配置说明

服务配置文件位于 `config/index.js`，主要配置项：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| port | 3000 | 服务端口 |
| rateLimit.windowMs | 60000 | 速率限制窗口（毫秒） |
| rateLimit.max | 20 | 窗口内最大请求数 |
| cacheEnabled | true | 是否启用解析结果缓存 |
| cacheTTL | 3600000 | 缓存有效期（毫秒，1小时） |
| shortUrlCacheTTL | 600000 | 短链跳转缓存有效期（毫秒，默认 10 分钟） |
| httpDetail.enabled | false | HTTP detail 快速路径开关，默认关闭 |
| httpDetail.timeoutMs | 800 | HTTP detail 快速路径超时（毫秒） |

### AI 相关配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| ai.enabled | true | 是否启用 AI 对话能力 |
| ai.provider | openai-compatible | 模型提供方类型 |
| ai.baseURL | https://api.openai.com/v1 | OpenAI 兼容接口地址 |
| ai.model | gpt-4.1-mini | 默认模型名称 |
| ai.sessionLimit | 10 | 每个会话保留的最近消息轮数 |
| ai.requestTimeoutMs | 30000 | 模型请求超时时间 |
| ai.rateLimit.max | 10 | AI 接口窗口内最大请求数 |
