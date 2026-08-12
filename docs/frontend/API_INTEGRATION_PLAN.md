# 前端接口接入方案

## 契约来源

后端接口契约以 `backend/docs/API.md` 为准。前端不复制完整接口定义，避免后端文档和前端文档出现字段重复、版本不一致或维护冲突。

本文档只描述前端消费接口的分层、约束和实施方式。

## 本阶段接入范围

接入：

- 视频解析相关接口。
- 音频解析相关接口。
- 下载或下载链接相关接口。
- 健康检查或基础状态接口，如后端文档存在且前端需要展示。

暂不接入：

- AI 对话接口。
- AI 解析接口。
- 会话历史、模型配置等 AI 扩展能力。

## 请求分层

```txt
pages/*.vue
  -> api/*.ts
    -> api/request.ts
      -> uni.request
```

约束：

- 页面层只处理用户交互和展示，不直接调用 `uni.request`。
- `api/*.ts` 只描述业务接口方法。
- `request.ts` 只负责通用请求能力和错误归一化。
- `types/*.ts` 只保存请求参数和响应结果类型。

## 建议模块

```txt
src/api/request.ts
src/api/parse.ts
src/api/download.ts

src/types/api.ts
src/types/parse.ts
src/types/download.ts
```

## 统一请求客户端

`request.ts` 负责：

- 注入 `baseURL`。
- 设置默认超时时间。
- 统一处理 HTTP 错误。
- 统一处理后端业务错误。
- 返回类型化结果。
- 隔离 H5、小程序、App 的平台差异。

建议接口形态：

```ts
export interface RequestOptions<TData = unknown> {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: TData
  header?: Record<string, string>
}

export function request<TResponse, TData = unknown>(
  options: RequestOptions<TData>,
): Promise<TResponse>
```

## 错误处理策略

前端统一将错误归一为：

```ts
export interface ApiError {
  message: string
  statusCode?: number
  code?: string | number
  detail?: unknown
}
```

页面只消费 `message` 和必要的 `detail`，不直接解析原始响应。

## 媒体链接处理策略

`POST /api/parse` 返回的 `videoUrl`、`audioUrl` 是后端解析得到的上游媒体候选地址，不应直接作为用户复制或浏览器打开的公开下载链接。

原因：

- 上游 CDN 链接通常带短期签名和防盗链校验。
- 浏览器或小程序直接访问可能缺少 `Referer`、`User-Agent` 等上下文，出现 `403 Forbidden`。
- 媒体直链可能过期，不适合长期保存在前端历史或对外分享。

前端规则：

- “下载视频”“下载音频”统一走后端 `GET /api/download`。
- “复制下载链接”复制后端下载接口地址，不复制 `douyinvod.com` 等上游 CDN 直链。
- 如需复制原始分享链接，应复制 `shareUrl`，不要复制解析出的媒体直链。
- 小程序端下载能力不稳定时，可以降级为复制后端下载链接。
- 当前小程序端点击下载时降级为复制后端下载链接，由用户在可访问后端域名的环境中打开。

## 配置策略

建议使用环境变量区分后端地址：

```txt
.env.development
.env.production
```

建议变量：

```txt
VITE_API_BASE_URL=
VITE_PUBLIC_DOWNLOAD_BASE_URL=
```

平台注意：

- H5 本地可以访问本机代理或本地后端地址。
- 小程序和 App 需要使用可访问的局域网 IP 或测试环境域名。
- 生产小程序通常需要配置合法请求域名。
- 开发环境默认使用 `http://localhost:3000`。
- 生产环境不默认指向 `localhost`；若 `VITE_API_BASE_URL` 留空，H5 将使用同源相对路径，部署时需要由网关或反向代理转发 `/api`。
- `VITE_PUBLIC_DOWNLOAD_BASE_URL` 用于生成“复制下载链接”的公网地址。小程序端必须配置为可访问的 HTTPS 后端域名，不能依赖相对路径。

## 页面接入顺序

1. 视频解析页接入解析接口。
2. 音频解析页接入解析接口。
3. 结果详情页接入复制和下载能力。
4. 历史记录页保存成功解析结果。
5. 根据真实接口返回字段补齐类型。

## AI 接口预留

后续如需接入 AI 能力，再新增：

```txt
src/api/ai.ts
src/types/ai.ts
src/pages/ai/chat.vue
```

当前阶段不创建实际 AI 请求方法，避免未使用代码和过早抽象。

## 文档维护规则

- 后端接口字段变更时，优先更新 `backend/docs/API.md`。
- 前端只同步对应 TypeScript 类型和调用方法。
- 前端文档不粘贴后端完整 API 表格。
- 若接口消费方式发生变化，只更新本文档和对应源码。
