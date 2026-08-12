# 前端实施状态

## 已完成

- 已创建 `frontend/` UniApp Vue3 TypeScript 项目骨架。
- 已建立 H5、小程序方向的基础配置文件，并校正到 UniApp 标准根目录结构。
- 已创建首页、解析工作台和历史页；详情页已从路由中移除。
- 已封装统一请求层 `src/api/request.ts`。
- 已接入非 AI 接口的前端 API 模块：
  - `GET /api/health`
  - `POST /api/parse`
  - `GET /api/download`
- 已建立解析结果、下载请求和统一响应类型。
- 已实现本地解析历史存储。
- 已保持 AI 接口不接入，仅保留后续扩展规划。
- 已完成依赖安装并生成 `package-lock.json`。
- 已完成 `npm run type-check`。
- 已完成 `npm run build:h5`。
- 已完成 `npm run build:mp-weixin`。
- 已完成 `npm run build:mp-toutiao`。
- 已清理旧的视频解析页、音频解析页和结果详情页。
- 已将复制媒体链接调整为复制后端 `/api/download` 下载链接，避免复制上游 CDN 直链导致 403。
- 已补充 `.env.development`、`.env.production` 和 `.env.example`，明确后端地址配置。
- 已将生产环境默认 API 地址调整为同源相对路径，避免误指向 `localhost`。
- 已新增 `VITE_PUBLIC_DOWNLOAD_BASE_URL`，将接口请求地址与用户可复制的公网下载地址解耦。
- 已关闭默认 `uniStatistics`，避免小程序端额外要求配置统计上报合法域名。
- 已将小程序端下载操作降级为复制后端下载链接，避免文件流下载/打开能力差异。
- 已锁定 `sass@1.77.8`，消除当前 UniApp 工具链下的 Sass legacy JS API 构建警告。

## 未完成

- 未做真实后端联调。
- 未在微信开发者工具或抖音开发者工具中做手工运行验证。

## 当前阻塞

暂无阻断构建的问题。

## 下一步

环境允许执行包管理命令后，按以下顺序继续：

```bash
cd frontend
npm install
npm run type-check
npm run build:h5
npm run build:mp-weixin
npm run build:mp-toutiao
```

若 UniApp 依赖链对 Vue 小版本存在约束，以实际安装结果和 UniApp 官方兼容范围为准调整 `package.json`。
