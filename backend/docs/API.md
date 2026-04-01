# 抖音解析器 API 文档

## 概述

抖音解析器后端提供 RESTful API，用于解析抖音视频链接并下载视频/音频内容。

**基础地址**: `http://localhost:3000`

**内容类型**: `application/json`

---

## 通用说明

### 速率限制

- 限制：每分钟 20 次请求
- 超出限制返回：429 Too Many Requests

### 响应格式

所有 API 响应遵循以下格式：

**成功响应**:
```json
{
  "success": true,
  "data": { ... }
}
```

**错误响应**:
```json
{
  "success": false,
  "error": "错误描述信息"
}
```

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
  "success": true,
  "message": "Service is running",
  "timestamp": "2024-01-01T12:00:00.000Z"
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
  "success": true,
  "data": {
    "source": "puppeteer",
    "title": "视频标题",
    "author": "作者昵称",
    "cover": "https://.../cover.jpg",
    "duration": 15000,
    "videoUrl": "https://.../video.mp4",
    "audioUrl": "https://.../audio.mp3",
    "audioReady": true
  }
}
```

**响应字段说明**:
| 字段 | 类型 | 说明 |
|------|------|------|
| source | string | 数据来源：`puppeteer` 或第三方 API |
| title | string | 视频标题 |
| author | string | 作者昵称 |
| cover | string | 封面图片 URL |
| duration | number | 视频时长（毫秒） |
| videoUrl | string | 无水印视频下载链接 |
| audioUrl | string | 原声音频链接（可选） |
| audioReady | boolean | 是否有可用的原声音频 |

**错误响应**:
```json
{
  "success": false,
  "error": "URL is required"
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
- 缓存有效期：1 小时（可配置）
- 相同视频重复下载时，直接从缓存获取解析结果，无需重新解析

#### 响应

- 成功：返回文件流（`video/mp4` 或 `audio/mpeg`）
- 失败：返回 JSON 错误信息

**错误响应示例**:
```json
{
  "success": false,
  "error": "type and url are required"
}
```

---

## 错误码说明

| HTTP 状态码 | 说明 |
|-------------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 429 | 请求过于频繁，超出速率限制 |
| 500 | 服务器内部错误 |

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
  if (!result.success) {
    console.error('解析失败:', result.error);
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
