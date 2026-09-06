# 抖音视频详情接口分析

## Scope

- 目标接口：`GET https://www.douyin.com/aweme/v1/web/aweme/detail/`
- 目标场景：用户提交抖音视频页 URL 或分享短链后，短期解析公开视频详情、视频地址和音频地址。
- 观察样本：`aweme_id=7640693904237506932` 的详情接口响应。
- 授权与边界：仅分析用户提供的响应结构；不保存完整 Cookie、令牌、风控签名、完整 CDN 签名 URL。
- 使用策略：即时解析、即时下载或转发，不长期保存详情接口签名参数和 CDN URL。

## Site Architecture

抖音 Web 视频页属于前端页面加接口拉取数据的架构。视频详情由 `/aweme/v1/web/aweme/detail/` 返回，接口请求依赖浏览器态参数、风控参数或登录/会话上下文。

无登录、无完整浏览器态参数时，详情接口可能返回：

```text
HTTP 200
Content-Length: 0
X-Whale-Throughput-Abort-Data: 强制登录
```

因此抖音解析链路不能依赖裸 HTTP 拼接参数稳定获取详情；当前项目对抖音保留浏览器解析和第三方兜底，不应将本结论直接外推到其他平台。

## Endpoint Inventory

| Status | Method/transport | Normalized endpoint | Purpose | Trigger | Auth | Pagination | Evidence source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| observed | GET/HTTP | `/aweme/v1/web/aweme/detail/` | 获取单个视频详情 | 视频详情页加载 | 依赖浏览器态/风控参数，部分场景需要登录 | 无 | 用户提供的成功响应；本地匿名请求返回强制登录 |
| observed | GET/HTTP | `/aweme/v1/play/` | 根据 `video_id` 获取播放资源 | 详情响应中的兜底 URL | 依赖签名参数 | 无 | 出现在 `video.*.url_list[]` 中 |
| observed | GET/HTTP | `https://*.douyinvod.com/...` | 视频 CDN 直链 | 详情响应中的播放 URL | URL 自带短期签名 | 无 | 出现在 `video.*.url_list[]` 中 |
| observed | GET/HTTP | `https://*-cdn-tos.douyinstatic.com/obj/ies-music/*.mp3` | 音乐/BGM 文件 | 详情响应中的音乐 URL | 未观察到额外认证；仍应按短期资源处理 | 无 | 出现在 `music.play_url.url_list[]` 中 |

## Endpoint Details

### 视频详情接口

请求路径：

```text
GET /aweme/v1/web/aweme/detail/
```

关键查询参数：

```text
aweme_id
device_platform=webapp
aid=6383
channel=channel_pc_web
origin_type=video_page
pc_client_type=1
support_h265
support_dash
version_code
version_name
browser_*
webid
msToken
a_bogus
verifyFp/fp
x-secsdk-web-signature
```

说明：

- `aweme_id` 是业务主键，来自视频页路径或短链跳转后的目标 URL。
- `browser_*`、`webid`、`msToken`、`a_bogus`、`verifyFp/fp`、`x-secsdk-web-signature` 属于浏览器态或风控相关参数。
- 这些参数不应入库长期保存，也不应在日志中明文输出。

成功响应：

```json
{
  "status_code": 0,
  "aweme_detail": {},
  "log_pb": {
    "impr_id": "[REDACTED]"
  }
}
```

失败/受限响应可能是：

```text
HTTP 200
body: empty
reason: 强制登录
```

## Response Shapes

### 视频详情根对象

```text
aweme_detail.aweme_id
aweme_detail.desc
aweme_detail.caption
aweme_detail.preview_title
aweme_detail.duration
aweme_detail.create_time
aweme_detail.author
aweme_detail.statistics
aweme_detail.video
aweme_detail.music
```

### 视频资源

优先关注：

```text
aweme_detail.video.play_addr_h264.url_list[]
aweme_detail.video.play_addr.url_list[]
aweme_detail.video.bit_rate[].play_addr.url_list[]
aweme_detail.video.play_addr_265.url_list[]
aweme_detail.video.download_addr.url_list[]
```

样本中 `play_addr_h264` 是 1080p H.264 MP4：

```text
format: mp4
codec: h264
width: 1080
height: 1920
ratio: 1080p
url_key: *_h264_1080p_*
```

`bit_rate[]` 提供多档清晰度和编码：

```text
gear_name
quality_type
format
bit_rate
is_h265
is_bytevc1
play_addr.width
play_addr.height
play_addr.url_list[]
```

### 音频资源

音乐/BGM 地址：

```text
aweme_detail.music.play_url.url_list[]
```

样本中是 MP3：

```text
music.play_url.uri: https://.../ies-music/*.mp3
music.play_url.url_list[]: 多个 CDN 备用地址
```

注意：`music.play_url` 表示作品音乐或原声资源，不一定等价于视频 MP4 内的最终混音。样本中：

```text
aweme_detail.video.audio = {}
aweme_detail.video.bit_rate_audio = null
```

这说明详情响应没有给出独立 DASH 音频流；如果产品语义是“提取视频里的完整声音”，应下载 MP4 后用 ffmpeg 抽取音轨。

## Field Dictionary

| Status | Response path | Type | Meaning | Unit/format | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| verified | `status_code` | number | 接口业务状态码 | `0` 表示成功 | 用户提供响应 | 非 HTTP 状态码 |
| verified | `aweme_detail.aweme_id` | string | 视频 ID | 数字字符串 | 用户提供响应 | 与请求 `aweme_id` 一致 |
| verified | `aweme_detail.desc` | string | 视频描述 | 文本 | 用户提供响应 | 可作为标题兜底 |
| verified | `aweme_detail.duration` | number | 视频时长 | 毫秒 | 用户提供响应 | 样本为 `8134` |
| observed | `aweme_detail.author.nickname` | string | 作者昵称 | 文本 | 用户提供响应 | 可展示 |
| observed | `aweme_detail.author.uid` | string | 作者 ID | 数字字符串 | 用户提供响应 | 敏感度较高，谨慎保存 |
| observed | `aweme_detail.video.play_addr_h264.url_list[]` | string[] | H.264 视频播放地址 | 短期签名 URL | 用户提供响应 | 推荐默认视频源 |
| observed | `aweme_detail.video.play_addr.url_list[]` | string[] | 默认视频播放地址 | 短期签名 URL | 用户提供响应 | 通常与 H.264 一致或接近 |
| observed | `aweme_detail.video.play_addr_265.url_list[]` | string[] | H.265/ByteVC1 视频播放地址 | 短期签名 URL | 用户提供响应 | 兼容性较差，按客户端能力启用 |
| observed | `aweme_detail.video.bit_rate[]` | object[] | 多码率视频列表 | 数组 | 用户提供响应 | 可用于选择最优清晰度 |
| observed | `aweme_detail.video.download_addr.url_list[]` | string[] | 下载地址 | 短期签名 URL | 用户提供响应 | 可能带水印或下载标识 |
| observed | `aweme_detail.video.cdn_url_expired` | number | CDN URL 过期时间 | Unix 秒 | 用户提供响应 | 用于短期缓存过期控制 |
| verified | `aweme_detail.music.play_url.url_list[]` | string[] | 音乐/BGM 地址 | MP3 URL 数组 | 用户提供响应 | 不是视频音轨的强保证 |
| observed | `aweme_detail.music.title` | string | 音乐标题 | 文本 | 用户提供响应 | 可展示 |
| observed | `aweme_detail.music.author` | string | 音乐作者 | 文本 | 用户提供响应 | 可展示 |
| observed | `aweme_detail.statistics.*` | number | 互动统计 | 次数 | 用户提供响应 | 包含点赞、评论、收藏、分享等 |

## Data Models

建议在抖音接口调研阶段使用如下领域模型：

> 注意：这是本调研文档中的建议模型，不是当前运行时响应契约。当前代码以 `backend/utils/parseResultNormalizer.js` 定义的扁平兼容模型为准（例如 `videoUrl`、`audioUrl`、`videoCodec`、`audioReady`）。

```json
{
  "awemeId": "7640693904237506932",
  "title": "看我装 阴他们一手",
  "duration": 8134,
  "coverUrl": "[cover-url]",
  "video": {
    "url": "[video-url]",
    "backupUrls": ["[video-url]"],
    "format": "mp4",
    "codec": "h264",
    "width": 1080,
    "height": 1920,
    "bitRate": 1944887,
    "size": 1977464,
    "expiresAt": 1786082767
  },
  "music": {
    "url": "[music-url]",
    "backupUrls": ["[music-url]"],
    "title": "@无敌橙子创作的原声",
    "author": "无敌橙子",
    "duration": 8
  }
}
```

视频选择规则：

```text
1. 优先 `video.play_addr_h264`
2. 其次 `video.play_addr`
3. 再从 `video.bit_rate[]` 中筛选 H.264、最高分辨率、最高码率
4. 仅当客户端支持 H.265 时使用 `video.play_addr_265`
5. 最后使用 `video.download_addr` 兜底，并标记可能带水印
```

音频选择规则：

```text
1. 若业务语义是作品音乐/BGM，使用 `music.play_url.url_list[0]`
2. 若业务语义是提取视频完整声音，下载 MP4 后用 ffmpeg 抽取音轨
3. 没有 `music.play_url` 时，音乐资源返回 `null`
```

## Unknowns

- 完整详情请求的最小必要参数集合未知。
- `msToken`、`a_bogus`、`verifyFp/fp`、`x-secsdk-web-signature` 与 Cookie、UA、IP、时间戳之间的绑定关系未知。
- 不同视频类型下是否存在独立 DASH 音视频流未知。
- 私密、删除、地区限制、禁止下载视频的响应形态需要更多样本验证。
- CDN URL 的实际可用时长应以 `cdn_url_expired` 和下载验证为准。

## Risks And Limitations

- 详情接口有风控和登录判断，纯后端裸请求可能被判定为匿名访问。
- CDN URL 是短期签名资源，不适合长期入库或公开日志保存。
- `download_addr`、`download_suffix_logo_addr` 可能包含水印或平台后缀，不应作为默认无水印视频源。
- `music.play_url` 代表音乐/BGM，不保证等同于视频最终混音。
- 抖音解析链路应对空响应、强制登录、无 `aweme_detail`、无视频 URL、URL 过期等失败分支做显式错误处理。

## Engineering Notes

建议当前项目采用即时解析模型：

```text
用户输入 URL
-> 短链跟随跳转并提取 aweme_id
-> 请求详情接口
-> 标准化 aweme_detail
-> 返回短期可用的视频 URL / 音乐 URL
-> 如需“提取音频”，下载 MP4 后使用 ffmpeg 抽取
```

缓存策略：

```text
1. 可短期缓存标准化结果，但 TTL 不应超过 `video.cdn_url_expired`
2. 不缓存完整请求签名、Cookie、完整 CDN URL 到长期存储
3. 日志中对 URL query、Cookie、token 类字段做脱敏
```

## Save Prompt

本文档已保存为项目内接口分析记录，不包含完整敏感参数和完整签名 URL。
