# douyin-parser 前端

基于 `uni-app + Vue 3 + TypeScript` 的多端前端项目骨架，面向 H5、微信小程序和抖音小程序。

## 当前范围

- 已规划视频解析、音频解析、下载入口和历史记录页面。
- 已接入非 AI 接口的前端调用层：`/api/health`、`/api/parse`、`/api/download`。
- AI 接口暂不接入。

## 开发命令

```bash
npm install
npm run dev:h5
```

## 环境变量

复制 `.env.example` 为 `.env.local`，按运行端配置后端地址：

```txt
VITE_API_BASE_URL=http://localhost:3000
VITE_PUBLIC_DOWNLOAD_BASE_URL=http://localhost:3000
```

小程序和 App 端不能访问电脑上的 `localhost`，需要改为局域网 IP 或测试环境域名。

生产环境 `.env.production` 默认留空，H5 将使用同源相对路径访问 `/api`。部署时需要通过网关或反向代理把 `/api` 转发到后端服务。

`VITE_PUBLIC_DOWNLOAD_BASE_URL` 用于生成用户可复制的下载链接。H5 同源部署可以留空；小程序端必须配置可访问的 HTTPS 后端域名和平台合法请求域名。
