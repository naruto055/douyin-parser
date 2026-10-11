# douyin-parser 前端

基于 `uni-app + Vue 3 + TypeScript` 的多端前端，面向 H5、微信小程序和抖音小程序，支持抖音 / B 站视频解析与下载入口。

## 当前范围

- 已实现首页、解析工作台、视频 / 音频下载入口和本地历史记录。
- 已接入非 AI 接口的前端调用层：`/api/health`、`/api/parse`、`/api/download`。
- H5 打开后端下载地址，小程序端复制下载链接。
- AI 接口暂不接入。
- 类型检查与三端构建已通过，真实后端联调和小程序手工验收尚未完成，详见 [实施状态](../docs/frontend/IMPLEMENTATION_STATUS.md)。

## 开发命令

先按 [根目录快速开始](../README.md#快速开始) 启动后端，再在 `frontend/` 下执行：

```bash
npm ci
cp .env.example .env.development.local
npm run dev:h5
```

小程序开发命令为 `npm run dev:mp-weixin` 和 `npm run dev:mp-toutiao`；使用对应开发者工具导入 `dist/dev/` 下的平台产物，并在 `src/manifest.json` 配置 AppID。

## 检查与构建

```bash
npm run type-check
npm run build:h5
npm run build:mp-weixin
npm run build:mp-toutiao
```

生产产物分别位于 `dist/build/h5`、`dist/build/mp-weixin` 和 `dist/build/mp-toutiao`。

## 环境变量

首次使用时复制 `.env.example` 为 `.env.development.local`，已有对应本地配置时跳过复制。按运行端配置后端地址（不包含 `/api` 后缀）：

```txt
VITE_API_BASE_URL=http://localhost:3000
VITE_PUBLIC_DOWNLOAD_BASE_URL=http://localhost:3000
```

小程序和 App 端不能访问电脑上的 `localhost`，需要改为局域网 IP 或测试环境域名。

更改环境变量后重启开发服务器；生产环境修改后需要重新构建。仓库已有 `.env.development`，其优先级高于 `.env.local`，使用 `.env.development.local` 才能覆盖开发地址。

生产环境 `.env.production` 中的两个地址默认留空，H5 将使用同源相对路径访问 `/api`。部署时需要通过网关或反向代理把 `/api` 转发到后端服务。跨域部署或小程序生产构建时，在 `.env.production.local` 设置实际的 HTTPS 后端地址，例如：

```dotenv
VITE_API_BASE_URL=https://api.example.com
VITE_PUBLIC_DOWNLOAD_BASE_URL=https://api.example.com
```

`VITE_PUBLIC_DOWNLOAD_BASE_URL` 用于生成用户可复制的下载链接。H5 同源部署可以留空；小程序端必须配置可访问的 HTTPS 后端域名和平台合法请求域名。
