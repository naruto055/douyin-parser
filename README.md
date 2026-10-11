# douyin-parser · 抖音 / B 站解析工具

提供抖音、B 站普通公开视频的解析与音视频下载能力，包含 Node.js 后端和 UniApp 多端前端。

## 特性

- 🎬 **多平台解析**：支持抖音页面链接、B 站普通公开视频链接及短链接。
- 🎵 **音频下载**：优先下载可用音频直链，必要时通过 FFmpeg 从视频提取音频。
- 📥 **视频下载**：抖音优先使用 H.264 MP4；B 站在服务端合并 DASH 音视频，返回带声音的 MP4。
- 🚀 **浏览器复用与降级**：抖音主链路使用 Puppeteer 浏览器池，失败后尝试第三方解析接口。
- 📱 **多端前端**：提供首页、解析工作台和本地历史记录，面向 H5、微信小程序和抖音小程序。

## 技术栈

| 模块 | 主要技术 |
| --- | --- |
| 前端 | UniApp、Vue 3、TypeScript、Pinia、uni-ui、Vite |
| 后端 | Node.js、Express 4、Axios、express-rate-limit |
| 解析与下载 | Puppeteer、puppeteer-extra、Stealth Plugin、fluent-ffmpeg、ffmpeg-static |

## 快速开始

### 环境要求

- 推荐 Node.js 24 LTS；后端声明的最低版本为 18，但当前测试脚本使用较新版本的 Node.js 测试运行器选项。
- npm（前端）与 pnpm（后端）；依赖分别由 `frontend/package-lock.json` 和 `backend/pnpm-lock.yaml` 管理。
- 后端建议至少 2 GB 可用内存、10 GB 可用磁盘空间。
- 可用的 Chromium 和系统依赖。后端在启动时初始化 Puppeteer 浏览器池，即使只调用 B 站接口，也需要浏览器能够启动。
- 音频提取及 B 站音视频合并需要 FFmpeg，优先使用依赖提供的 `ffmpeg-static` 二进制，也支持系统 FFmpeg 或 `FFMPEG_PATH` 指定路径。

下列命令使用 Bash，Windows PowerShell 可将 `cp` 替换为 `Copy-Item`。已有对应本地配置文件时保留原配置，跳过复制步骤。

### 1. 获取项目

```bash
git clone https://github.com/naruto055/douyin-parser.git
cd douyin-parser
```

### 2. 启动后端

在仓库根目录执行：

```bash
cd backend
pnpm install
cp .env.example .env
pnpm start
```

服务默认监听 `3000` 端口，可在 `backend/.env` 中通过 `PORT` 修改。

启动后访问：

- 健康检查：<http://localhost:3000/api/health>
- 后端联调控制台：<http://localhost:3000/>

开发时也可在 `backend/` 执行 `pnpm dev`；当前与 `pnpm start` 一样运行 `node app.js`，不包含自动重启。

### 3. 启动前端 H5

保持后端运行，另开一个终端，在仓库根目录执行：

```bash
cd frontend
npm ci
cp .env.example .env.development.local
npm run dev:h5
```

使用终端输出的 H5 地址访问前端。前端与后端是两个独立服务，`http://localhost:3000/` 打开的是后端联调页。

`frontend/.env.development.local` 中的开发配置为：

```dotenv
VITE_API_BASE_URL=http://localhost:3000
VITE_PUBLIC_DOWNLOAD_BASE_URL=http://localhost:3000
```

| 配置项 | 用途 |
| --- | --- |
| `VITE_API_BASE_URL` | 后端服务地址，不包含 `/api` 后缀 |
| `VITE_PUBLIC_DOWNLOAD_BASE_URL` | 生成用户可复制的后端下载链接，可与 API 请求地址不同 |

更改前端环境变量后需要重启开发服务器。仓库已有 `.env.development`，其优先级高于 `.env.local`，因此使用 `.env.development.local` 覆盖开发地址。H5 生产环境默认使用同源 `/api` 请求，部署配置见 [构建与部署](#构建与部署)。

### 4. 小程序开发

在 `frontend/` 下选择目标平台：

```bash
npm run dev:mp-weixin
# 或
npm run dev:mp-toutiao
```

分别使用微信开发者工具或抖音开发者工具导入 `frontend/dist/dev/mp-weixin` 或 `frontend/dist/dev/mp-toutiao`，并在 [manifest.json](./frontend/src/manifest.json) 配置对应平台的 AppID。

手机真机不能通过 `localhost` 访问电脑上的后端。联调时将上述两个环境变量改为可达的局域网 IP 或测试域名；正式运行需使用可访问的 HTTPS 后端域名，并配置平台合法请求域名。

H5 下载会打开后端下载地址；小程序当前复制下载链接，用户可在浏览器中打开。小程序端尚未完成开发者工具手工验收，详见 [前端实施状态](./docs/frontend/IMPLEMENTATION_STATUS.md)。

## 使用示例

### 页面操作

1. 打开 H5，进入解析工作台。
2. 粘贴抖音分享文案或抖音 / B 站视频页面链接，点击解析。
3. 查看标题、作者、平台和可用媒体信息，选择下载视频、音频或复制下载链接。
4. 在历史页重新打开已保存的记录；音频操作是否可用取决于 `audioReady`。

### API 调用

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `POST` | `/api/parse` | 解析平台视频页链接 |
| `GET` | `/api/download` | 通过 `type=video` 或 `type=audio` 下载文件 |

将下面示例中的页面链接替换为实际可访问的视频链接：

```bash
curl http://localhost:3000/api/health

curl -X POST http://localhost:3000/api/parse \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.bilibili.com/video/BV1TF8G6oERL/"}'

curl -G http://localhost:3000/api/download \
  --data-urlencode 'type=video' \
  --data-urlencode 'url=https://www.bilibili.com/video/BV1TF8G6oERL/' \
  -o video.mp4
```

普通 JSON 响应格式为 `{ code, message, data }`，业务失败可能返回 HTTP 200，需要同时检查 `code`。下载成功返回文件流；下载失败时应检查响应内容，避免把 JSON 错误信息当成媒体文件。

完整参数和错误码见 [后端 API 文档](./backend/docs/API.md)。

## 开发与验证

后端测试（在 `backend/` 执行）：

```bash
pnpm test
```

前端类型检查（在 `frontend/` 执行）：

```bash
npm run type-check
```

前端构建命令见下一节。类型检查和构建通过后，仍需验证真实解析、下载文件可播放及目标平台的手工运行。

## 构建与部署

前端生产构建（在 `frontend/` 执行）：

| 命令 | 产物目录 | 用途 |
| --- | --- | --- |
| `npm run build:h5` | `dist/build/h5` | 部署到静态服务器 |
| `npm run build:mp-weixin` | `dist/build/mp-weixin` | 导入微信开发者工具 |
| `npm run build:mp-toutiao` | `dist/build/mp-toutiao` | 导入抖音开发者工具 |

H5 同源部署时，仓库的 `.env.production` 已将两个地址设为空，通过网关将 `/api` 转发至后端。前后端使用不同域名或构建小程序时，需要在 `frontend/.env.production.local` 中配置可访问的 HTTPS 后端地址，例如：

```dotenv
VITE_API_BASE_URL=https://api.example.com
VITE_PUBLIC_DOWNLOAD_BASE_URL=https://api.example.com
```

将示例域名替换为实际服务地址。小程序不能使用空地址进行同源请求；H5 同源部署应确保没有额外配置覆盖默认空值。前端环境变量会进入构建产物，修改后需要重新构建。

后端运行方式、Linux 系统依赖、PM2 进程管理和 Nginx 示例见 [服务器部署方案](./docs/技术方案.md#五服务器部署方案)。该方案主要覆盖后端，UniApp H5 产物需要单独部署。

## 当前范围与限制

- 抖音主解析链路为 Puppeteer，失败后回退第三方 API；可选的 HTTP detail 快速路径默认关闭。
- B 站支持未登录即可访问的普通公开视频和 `b23.tv` 短链接，默认解析第 1 P；视频下载需要同时取得可用音视频流。
- 下载接口接收抖音 / B 站页面链接，不接收直接媒体文件链接。
- 抖音独立音频可能是作品音乐 / BGM，并不保证包含视频中的全部原声；B 站音频通常保留源流格式 `.m4a`。
- 无水印情况与上游媒体来源有关，不能保证每次解析都返回无水印文件。
- 前端已记录类型检查和三端构建通过，真实后端联调及小程序手工验收尚未完成，见 [实施状态](./docs/frontend/IMPLEMENTATION_STATUS.md)。

## 常见问题

| 问题 | 排查方式 |
| --- | --- |
| 后端启动时找不到浏览器或 Chromium 启动失败 | 检查 Puppeteer 安装脚本是否执行、浏览器是否已下载及系统依赖是否齐全；pnpm 提示忽略依赖脚本时，按提示允许 Puppeteer 等所需依赖执行安装脚本后重装依赖 |
| 音频提取或 B 站视频合并报 FFmpeg 错误 | 检查 `ffmpeg-static` 二进制是否可执行，或安装系统 FFmpeg / 设置 `FFMPEG_PATH` |
| H5 提示无法连接后端 | 先访问 `/api/health`，再核对后端端口与 `VITE_API_BASE_URL`，修改环境变量后重启前端 |
| 小程序或手机访问失败 | 将 `localhost` 改为可达 IP / 域名，并核对网络连通性及平台合法域名配置 |
| 修改开发地址不生效 / H5 生产环境仍请求 `localhost` | 开发地址放在 `.env.development.local`，生产地址放在 `.env.production.local`；核对终端环境变量是否覆盖配置，再重启或重新构建 |
| 下载直链失效或返回 403 | 使用后端 `/api/download` 地址而非上游 CDN 直链；仍失败时重新解析并检查平台资源可用性 |

## 项目结构

```text
douyin-parser/
├── backend/                # 后端服务
│   ├── config/             # 运行配置
│   ├── docs/API.md         # API 契约
│   ├── public/             # 静态联调控制台
│   ├── routes/             # HTTP 路由
│   ├── services/           # 解析与下载服务
│   ├── tests/              # Node.js 原生测试
│   └── utils/              # 解析器、浏览器池、音视频与流工具
├── frontend/               # UniApp 前端
│   └── src/                # 页面、组件、API、状态与类型
├── docs/                   # 项目设计、方案与实施记录
│   └── frontend/           # 前端选型、接入方案与实施状态
├── AGENTS.md               # 仓库协作约束
└── README.md
```

## 文档导航

- [后端 API 文档](./backend/docs/API.md)：接口参数、响应和错误码。
- [技术方案详解](./docs/技术方案.md)：设计背景和后端部署示例，具体接口以 API 文档为准。
- [前端说明](./frontend/README.md)：前端开发命令与环境变量。
- [前端文档索引](./docs/frontend/README.md)：选型、实施计划和接口接入方案。
- [前端实施状态](./docs/frontend/IMPLEMENTATION_STATUS.md)：已完成内容、验证范围和下一步。

## 贡献与反馈

欢迎通过 [GitHub Issues](https://github.com/naruto055/douyin-parser/issues) 反馈问题，或提交 Pull Request。

问题反馈请提供运行系统、Node.js 版本、目标平台、复现步骤和脱敏后的错误日志。提交改动前，请阅读 [仓库协作说明](./AGENTS.md) 与目标目录的 `AGENTS.md`，运行相关测试 / 类型检查 / 构建，并同步受影响文档。

## 免责声明

本工具仅供学习和技术研究使用，下载的内容版权归原作者所有。请勿将下载的内容用于商业用途，使用本工具产生的一切法律责任由使用者自行承担。

## 许可证

后端 `package.json` 声明为 MIT。仓库目前尚未提供独立的 `LICENSE` 文件；正式许可证文本及版权归属信息仍需补充。
