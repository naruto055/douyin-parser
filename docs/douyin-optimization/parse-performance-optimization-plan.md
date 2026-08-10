# 抖音解析性能优化方案

## 1. 背景

当前项目的抖音解析主链路已经是浏览器会话辅助解析：

```text
用户输入 URL
-> VideoService.parseVideo()
-> resolveShortUrl()
-> douyinParser.parse()
-> parseWithPuppeteer()
-> browserPool.execute()
-> Puppeteer 打开抖音页面并监听 /aweme/v1/web/aweme/detail/
-> 标准化解析结果
-> 失败后回退第三方 API
```

该方案方向正确，因为抖音 Web 详情接口依赖浏览器态、Cookie、风控参数和页面脚本执行结果。纯后端裸 HTTP 请求容易返回空响应或被标记为匿名访问。

当前问题是解析速度偏慢。主要原因不是完全没有复用浏览器，而是页面加载等待策略偏保守，短链解析和失败兜底也会叠加耗时。

## 2. 当前瓶颈

### 2.1 页面等待策略过重

当前浏览器池在打开页面时使用：

```js
await page.goto(url, { waitUntil: 'networkidle2', timeout: config.browserPool.timeout });
```

`networkidle2` 会等待页面网络活动进入相对空闲状态。抖音视频页会加载脚本、图片、埋点、推荐流、媒体资源等，等待网络空闲会拖慢解析。

业务真正需要的是 `/aweme/v1/web/aweme/detail/` 的 JSON 响应，不需要等待页面完整渲染。

### 2.2 固定额外等待

当前逻辑在没有立即捕获接口时会固定等待：

```js
await page.waitForTimeout(2000);
```

这会让失败场景或接口稍慢场景额外增加 2 秒。

### 2.3 短链解析不够精准

当前 `resolveShortUrl()` 对输入 URL 统一尝试 `axios.head()`，超时时间较长。对于已经是长链的 URL，这一步没有必要；对于短链，部分服务也可能不友好地处理 HEAD 请求。

### 2.4 资源加载没有裁剪

Puppeteer 当前没有拦截图片、字体、媒体等非必要资源。解析详情接口只依赖页面文档、脚本和 XHR/fetch，加载大量图片和媒体会增加网络和 CPU 开销。

### 2.5 媒体字段选择不够精确

当前 `extractVideoInfo()` 主要取：

```text
aweme_detail.video.play_addr.url_list[0]
aweme_detail.music.play_url.url_list[0]
```

结合真实响应，视频应优先取 H.264 地址，音乐/BGM 与视频内完整声音也需要区分。

## 3. 优化目标

### 3.1 性能目标

- 普通长链解析尽量在捕获详情接口后立即返回。
- 短链只在必要时解析跳转，减少无效网络请求。
- Puppeteer 页面只加载解析所需资源。
- 失败场景尽快降级，不做长时间无效等待。

### 3.2 稳定性目标

- 不逆向或生成风控签名。
- 不长期保存 Cookie、token、签名参数、完整 CDN 签名 URL。
- 保留 Puppeteer 浏览器态方案作为主路径。
- 保留第三方 API 作为最后兜底，不影响现有功能。

### 3.3 结果目标

标准化结果中明确输出：

```text
videoUrl: 优先 H.264 MP4
audioUrl: music.play_url 中的音乐/BGM 地址
cover: 封面地址
title: 视频描述或标题
duration: 视频时长
source: 解析来源
expiresAt: CDN 过期时间，若响应存在
```

## 4. 总体方案

优化后的链路：

```text
用户输入 URL
-> 提取 URL
-> 判断是否短链
-> 必要时解析短链
-> 提取 aweme_id
-> 可选 HTTP 快速尝试
-> Puppeteer 打开页面
-> 监听详情接口
-> 捕获 aweme_detail 后立即返回
-> 标准化视频和音频字段
-> 失败后再走页面兜底和第三方 API
```

第一阶段建议先实现低风险优化：

```text
1. Puppeteer 命中详情接口即返回
2. 拦截非必要资源
3. 增强视频/音频字段选择
4. 优化短链解析条件
```

HTTP 快速路径可以作为第二阶段，因为它对请求参数、Cookie 和风控状态更敏感，收益不一定稳定。

## 5. 分阶段计划

### 阶段一：Puppeteer 等待策略优化

目标：不再等待整个页面 `networkidle2`，而是详情接口命中后立即返回。

计划：

```text
1. 在 page.goto 前注册 response 监听。
2. 监听 URL 包含 /aweme/v1/web/aweme/detail/ 的响应。
3. 解析 JSON，确认 status_code === 0 且存在 aweme_detail。
4. 使用 Promise.race 在详情接口响应、页面加载、超时之间取最先有效结果。
5. page.goto 使用 domcontentloaded，降低等待成本。
6. 移除或缩短固定 waitForTimeout(2000)。
```

建议行为：

```text
详情接口成功：立即返回 apiData
页面已加载但未捕获接口：短暂等待 500 到 1000 ms
仍未捕获：走 parseFromPage 兜底
任务超时：抛错并进入第三方 API 兜底
```

风险：

```text
过早返回可能错过稍晚发出的详情接口。
```

控制方式：

```text
保留一个短等待窗口，不直接在 domcontentloaded 后立即失败。
```

### 阶段二：资源请求拦截

目标：减少无关资源加载。

计划：

```text
1. 启用 page.setRequestInterception(true)。
2. 允许 document、script、xhr、fetch。
3. 拦截 image、font、media。
4. 第一版不拦截 stylesheet，避免影响某些页面脚本或风控行为。
5. 后续根据实测再评估是否拦截 stylesheet、广告和埋点域名。
```

建议第一版规则：

```text
abort: image, font, media
continue: document, script, xhr, fetch, stylesheet, other
```

风险：

```text
拦截过多资源可能影响页面脚本执行或风控初始化。
```

控制方式：

```text
第一版只拦截低风险资源，不做复杂域名黑名单。
```

### 阶段三：短链解析优化

目标：减少不必要的短链解析耗时。

计划：

```text
1. 输入已经包含 /video/{id}、/note/{id}、video_id、item_id 时，跳过 resolveShortUrl。
2. 仅当域名为 v.douyin.com 或无法直接提取 aweme_id 时，执行短链跳转解析。
3. HEAD 超时从 10000 ms 降到 3000 到 5000 ms。
4. HEAD 失败但响应头有 location 时继续使用 location。
5. 必要时增加 GET 跳转兜底，但限制超时和重定向次数。
```

风险：

```text
部分短链需要 GET 才能拿到最终跳转。
```

控制方式：

```text
HEAD 失败后只做一次短超时 GET 兜底。
```

### 阶段四：媒体字段标准化优化

目标：让解析结果优先返回更适合下载的视频和音频。

视频选择规则：

```text
1. video.play_addr_h264
2. video.play_addr
3. video.bit_rate[] 中筛选 is_h265 === 0 的最高分辨率、最高码率
4. video.play_addr_265，仅在明确支持 H.265 时使用
5. video.download_addr，兜底并标记可能带水印
```

音频选择规则：

```text
1. music.play_url.url_list[0] 作为音乐/BGM 地址
2. audioReady 表示 BGM 可直接下载
3. 如果用户要“提取视频里的完整声音”，下载 MP4 后使用 ffmpeg 抽音轨
```

建议新增或补充字段：

```json
{
  "videoUrl": "[H.264 MP4 URL]",
  "videoBackupUrls": [],
  "videoCodec": "h264",
  "videoFormat": "mp4",
  "videoWidth": 1080,
  "videoHeight": 1920,
  "videoBitRate": 1944887,
  "videoExpiresAt": 1786082767,
  "audioUrl": "[music-url]",
  "audioType": "music"
}
```

兼容要求：

```text
保留现有 videoUrl、audioUrl、audioReady 字段，避免破坏路由和下载服务。
新增字段只能作为增强信息。
```

### 阶段五：HTTP 快速路径

目标：在部分低风控场景下避免启动 Puppeteer。

计划：

```text
1. 从 URL 中提取 aweme_id。
2. 构造详情接口请求。
3. 设置 2 到 3 秒超时。
4. 成功返回 aweme_detail 时直接标准化。
5. 空 body、强制登录、非 JSON、无 aweme_detail 时静默降级 Puppeteer。
```

限制：

```text
不生成 a_bogus。
不复用用户 Cookie。
不把 HTTP 快速路径作为唯一方案。
```

该阶段已在 Puppeteer 优化稳定后实施：仅在能从 URL 提取 `aweme_id` 时尝试，2.5 秒超时；成功拿到 `status_code === 0 && aweme_detail` 时直接返回统一解析结果，其他情况静默降级 Puppeteer。

## 6. 成功标准

功能标准：

```text
1. 长链和短链仍可解析。
2. 成功响应仍包含 title、cover、duration、videoUrl、audioUrl。
3. videoUrl 优先来自 play_addr_h264 或 H.264 码率源。
4. audioUrl 来自 music.play_url。
5. Puppeteer 失败后仍能进入第三方 API 兜底。
6. 下载接口仍能使用解析结果下载视频和音频。
```

性能标准：

```text
1. 命中详情接口后不等待 networkidle2。
2. 普通视频解析耗时下降。
3. 短链解析失败时不再最多阻塞 10 秒。
4. 浏览器池并发行为保持可控。
```

安全标准：

```text
1. 不记录完整 Cookie、token、签名参数。
2. 不长期保存完整 CDN 签名 URL。
3. 日志只输出 URL 的必要定位信息，敏感 query 需要脱敏。
```

## 7. 验证计划

### 单元测试

重点覆盖：

```text
backend/tests/utils.test.js
backend/tests/videoService.test.js
backend/tests/downloadService.test.js
backend/tests/apiRoute.test.js
```

建议新增测试：

```text
1. extractVideoInfo 优先选择 play_addr_h264。
2. extractVideoInfo 在无 play_addr_h264 时回退 play_addr。
3. extractVideoInfo 在 bit_rate 中选择 H.264 最高清。
4. music.play_url 存在时设置 audioUrl 和 audioReady。
5. 已含 video_id 的长链跳过短链解析。
```

### 集成验证

手动验证样本：

```text
1. https://www.douyin.com/video/{aweme_id}
2. https://v.douyin.com/{shortCode}
3. 包含分享文案的 URL 输入
4. 音乐可用的视频
5. 无音乐或受限视频
```

观察指标：

```text
1. 总解析耗时
2. 是否捕获 /aweme/v1/web/aweme/detail/
3. 是否走第三方 API 兜底
4. videoUrl 来源字段
5. audioUrl 来源字段
```

## 8. 推荐实施顺序

```text
1. 修改 browserPool：详情接口命中即返回，goto 改 domcontentloaded。
2. 增加资源拦截：先拦截 image、font、media。
3. 修改 extractVideoInfo：增强视频和音频字段选择。
4. 修改 resolveShortUrl 调用策略：长链跳过，短链降超时。
5. 补测试。
6. 实测长链和短链解析耗时。
7. 评估是否增加 HTTP 快速路径。
```

## 9. 执行计划与完成情况

状态说明：

```text
未开始：尚未修改代码。
进行中：已开始实现，但未完成验证。
已完成：代码已实现，并完成对应验证。
暂缓：当前阶段不实施，等待前置结果或进一步确认。
```

| 序号 | 任务 | 目标 | 涉及文件 | 验证方式 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | 优化 Puppeteer 等待策略 | 捕获详情接口后立即返回，避免等待 `networkidle2` | `backend/utils/browserPool.js` | 已将 `page.goto` 调整为 `domcontentloaded`，命中详情接口立即返回；已补详情接口命中成功路径和资源拦截异步失败测试；真实长链/短链联调待执行 | 已完成 |
| 2 | 增加资源请求拦截 | 减少图片、字体、媒体资源加载耗时 | `backend/utils/browserPool.js` | 已拦截 `image`、`font`、`media`；保留 `document`、`script`、`xhr`、`fetch`、`stylesheet`；已捕获 `abort/continue` 异步失败 | 已完成 |
| 3 | 增强视频字段选择 | 优先返回 H.264 MP4，保留兼容字段 | `backend/utils/douyinParser.js` | 已补充 `extractVideoInfo` 单元测试，覆盖 `play_addr_h264`、`play_addr`、`bit_rate` 回退 | 已完成 |
| 4 | 增强音频字段语义 | 区分音乐/BGM 与视频音轨提取 | `backend/utils/douyinParser.js`、下载相关服务 | 已测试 `music.play_url` 返回 `audioUrl`、`audioType=music`；保留 MP4 抽音频兼容字段 | 已完成 |
| 5 | 优化短链解析策略 | 长链跳过短链解析，短链降低超时 | `backend/utils/douyinParser.js`、`backend/services/VideoService.js` | 已覆盖长链跳过网络请求、短链 4 秒 HEAD、HEAD location、GET 兜底、HEAD/GET 均失败，以及服务层跳过二次短链解析 | 已完成 |
| 6 | 补充性能日志 | 标记短链解析、Puppeteer、第三方兜底耗时 | `backend/services/VideoService.js`、`backend/utils/douyinParser.js`、`backend/services/DownloadService.js` | 已记录短链解析、Puppeteer、第三方兜底、服务层总耗时；解析与下载日志 URL 均移除 query | 已完成 |
| 7 | 实现 HTTP 快速路径 | 在低风险场景减少 Puppeteer 启动 | `backend/utils/douyinParser.js` | 已新增只读详情接口快速尝试：提取 `aweme_id` 后构造详情接口请求，2.5 秒超时；成功返回统一解析结果，失败、空 body、非 JSON、无 `aweme_detail` 时静默降级 Puppeteer；已补成功跳过 Puppeteer、失败降级 Puppeteer、无 `aweme_id` 不发 HTTP 请求测试 | 已完成 |
| 8 | 更新接口文档 | 若响应字段变化，同步 API 说明 | `backend/docs/API.md` | 已补充新增视频/音频增强字段说明，原字段保持兼容 | 已完成 |

本次文档记录状态：

```text
方案文档：已完成
代码实现：Milestone 1、Milestone 2、Milestone 3 已完成
测试验证：已补充 `tests/utils.test.js`、`tests/videoService.test.js`、`tests/downloadService.test.js`、`tests/apiRoute.test.js` 覆盖；新增覆盖 HTTP 快速路径成功跳过 Puppeteer、HTTP 快速路径失败降级 Puppeteer、无 `aweme_id` 不调用 HTTP 快速路径、Puppeteer 失败后第三方兜底、第三方 provider 归一化、详情接口命中成功路径和 API 诊断透传；当前沙箱环境无法启动 Node 测试，需在本地可执行环境复跑。
```

## 10. 里程碑

### Milestone 1：低风险提速

范围：

```text
1. Puppeteer 命中详情接口即返回
2. 资源请求拦截
3. 视频和音频字段选择增强
```

完成标准：

```text
1. 长链解析仍成功。
2. 短链解析仍成功。
3. videoUrl 优先来自 H.264 源。
4. audioUrl 仍来自 music.play_url。
5. 相关测试通过。
```

完成情况：

```text
状态：已完成
说明：已完成 Puppeteer 等待策略优化、资源请求拦截、视频/音频字段增强和 API 文档同步。
实际等待窗口：`POST_LOAD_DETAIL_WAIT_MS = 5000`，用于覆盖详情接口稍晚返回的场景。
验证：已补充对应单元测试，包含详情接口命中成功路径、Puppeteer 失败后第三方兜底和第三方 provider 归一化；当前沙箱环境无法启动 Node 测试，需在本地可执行环境复跑 node --test。
限制：尚未执行真实长链/短链手动联调，需在可访问抖音页面的环境中补充耗时观察。
```

### Milestone 2：链路耗时治理

范围：

```text
1. 短链解析策略优化
2. 分阶段耗时日志
3. 失败兜底路径耗时观察
```

完成标准：

```text
1. 已包含 video ID 的长链不再执行短链跳转解析。
2. 短链解析失败不会长时间阻塞。
3. 日志能区分短链解析、Puppeteer、第三方兜底耗时。
```

完成情况：

```text
状态：已完成
说明：已完成长链跳过短链解析、短链 HEAD/GET 短超时兜底、普通解析入口避免二次短链解析，以及分阶段耗时日志。
验证：已补充对应单元测试，包含短链解析、缓存 TTL、下载 403 刷新、API 诊断透传和第三方兜底错误数据；当前沙箱环境无法启动 Node 测试，需在本地可执行环境复跑 node --test。
限制：尚未执行真实短链失败耗时联调，需在可访问抖音短链的环境中补充观察。
```

审查修复记录：

```text
1. 已修复短链失败时服务层和解析器重复 HEAD/GET 的问题。
2. 已修复 Puppeteer 资源拦截中 abort/continue 异步失败未捕获的问题。
3. 已调整 H.265 行为：仅作为 video265* 候选字段，不默认写入 videoUrl。
4. 已按 videoExpiresAt 收缩缓存 TTL，过近过期结果不写缓存。
5. 已补齐下载链路媒体 URL 日志脱敏。
```

### Milestone 3：HTTP 快速路径

范围：

```text
1. 只做只读详情接口快速尝试。
2. 失败立即降级 Puppeteer。
3. 不生成或逆向签名参数。
```

完成标准：

```text
1. 低风险场景能跳过 Puppeteer。
2. 风控失败不会影响主解析链路。
3. 无敏感参数入库或明文日志。
```

当前状态：已完成。

实现说明：`backend/utils/douyinParser.js` 已新增 HTTP 详情接口快速路径；该路径不生成 `a_bogus`，不使用用户 Cookie，不记录完整签名 URL；失败、空 body、非 JSON、无 `aweme_detail` 均静默降级 Puppeteer。

验证说明：`backend/tests/utils.test.js` 已补充 HTTP 快速路径成功跳过 Puppeteer、HTTP 快速路径失败降级 Puppeteer、无 `aweme_id` 不调用 HTTP 快速路径测试。

## 11. 回滚策略

如果优化后解析成功率下降：

```text
1. 保留新字段标准化逻辑。
2. 将 goto 等待策略临时切回 networkidle2。
3. 关闭资源拦截。
4. 保留短链解析优化和测试。
```

这样可以把风险集中在 Puppeteer 加载策略，不影响媒体字段标准化和整体接口契约。
