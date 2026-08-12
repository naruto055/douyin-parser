# 前端实施计划

## 背景

`douyin-parser` 当前核心能力位于后端，前端项目需要基于 `backend/docs/API.md` 消费解析与下载相关接口。为避免文档职责重叠，前端文档只描述前端如何消费接口，不复制后端完整接口契约。

AI 相关接口本阶段暂不接入，后续在接口稳定和页面需求明确后再单独规划。

## 目录规划

后续源码建议放在仓库根目录的 `frontend/`：

```txt
frontend/
  package.json
  vite.config.ts
  tsconfig.json
  src/
    App.vue
    main.ts
    manifest.json
    pages.json
    pages/
      index/
        index.vue
      parser/
        index.vue
      history/
        index.vue
    components/
      base/
      business/
    api/
      request.ts
      parse.ts
      download.ts
    types/
      api.ts
      parse.ts
      download.ts
    stores/
      app.ts
      history.ts
    utils/
      platform.ts
      clipboard.ts
      download.ts
    styles/
      variables.scss
      global.scss
    static/
```

## 阶段一：项目骨架

目标：创建可运行的 UniApp Vue3 TypeScript 项目。

任务：

- 初始化 `frontend/` UniApp Vue3 TypeScript 项目。
- Vue 依赖使用 Vue 3 最新稳定版，并在 `package.json` 中锁定版本范围。
- 配置 `@/` 路径别名。
- 配置基础 `pages.json`、`manifest.json` 和全局样式。
- 引入 `uni-ui` 基础组件能力。
- 建立 `api/`、`types/`、`stores/`、`utils/`、`components/`、`pages/` 目录。
- 保持页面可启动，不接真实接口。

验收：

- H5 端可以启动并展示首页。
- TypeScript 编译无基础配置错误。
- 初始页面在移动端宽度和 PC 宽度下布局稳定。

## 阶段二：页面框架

目标：先完成多端页面结构和核心交互占位。

页面：

- 首页：提供视频解析、音频解析入口。
- 解析工作台：链接输入、解析按钮、视频资源区、音频资源区。
- 解析工作台：集中展示解析结果、视频复制/下载、音频复制/下载入口。
- 历史记录页：展示本地解析历史。

不做：

- 不接 AI 对话接口。
- 不实现复杂登录、权限、会员或支付逻辑。
- 不引入全局复杂状态模型。

验收：

- 页面路由完整。
- 移动端使用单列布局。
- H5 PC 宽屏下内容区域居中或分栏展示。
- 主要按钮、输入框、结果卡片均有 loading、empty、error 占位状态。

## 阶段三：请求层与类型层

目标：在不绑定具体页面的前提下，建立可复用接口层。

任务：

- 封装 `src/api/request.ts`。
- 统一处理 `baseURL`、`timeout`、HTTP 状态码、业务错误。
- 按业务拆分 `parse.ts`、`download.ts`。
- 根据 `backend/docs/API.md` 建立 TypeScript 请求和响应类型。
- 保留 AI 接口模块位置，但本阶段不实现调用。

验收：

- 页面不直接调用 `uni.request`。
- 接口类型集中在 `types/` 下。
- 错误提示结构统一，不在页面重复拼接错误逻辑。
- 组合式逻辑优先使用 Vue 3 最新稳定特性，例如 `<script setup>`、`defineModel`、`useTemplateRef` 和响应式 props 解构。

## 阶段四：解析与下载接口接入

目标：接入非 AI 的后端接口。

任务：

- 接入视频解析接口。
- 接入音频解析接口。
- 接入下载或下载链接相关接口。
- 处理链接校验、请求中状态、失败提示和成功结果展示。
- 记录成功解析历史到本地存储。

验收：

- 视频和音频资源可从同一个解析工作台触发。
- 解析工作台能展示后端返回的关键字段。
- 复制链接、下载入口按平台能力分别处理。
- 请求失败时用户能看到明确错误提示。

## 阶段五：多端验证

目标：确认前端骨架和接口能力在目标端可用。

验证范围：

- H5 本地运行。
- H5 生产构建。
- 微信小程序构建。
- 抖音小程序构建可行性检查。

注意事项：

- 小程序端调试不能使用浏览器专属 API。
- 小程序和 App 端访问后端时不能使用 `localhost`。
- 下载能力需要按平台差异实现，不能假设所有端都支持浏览器下载。

## 后续扩展

- AI 接口页面和会话能力。
- 解析历史云端同步。
- 分享卡片或小程序分享路径。
- 接口 Mock 与自动化测试。
- 视觉主题与暗色模式。
