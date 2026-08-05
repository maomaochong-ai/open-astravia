# ADR-0048：图像生成业务归插件，宿主提供通用网络与私有存储

## 状态

已采纳，第 1、3 条被 ADR-0056 部分取代：供应商适配与 API key 从插件迁到 Vetta 网关，SDK 增加 `ctx.gateway.request`。其余条款继续有效。

## 背景

`image-gen` 原本只包含 UI，供应商协议、配置解析、图像持久化、编辑谱系和 Agent 工具分别内嵌在 desktop-app、runtime-core 与 coding-agent。插件即使被禁用，宿主仍会注入 `generate_image` / `edit_image`，形成双重生命周期和跨包版本耦合。

## 决策

1. `image-gen` 自行注册 `generate_image` / `edit_image`，拥有供应商适配、提示词、持久化记录、编辑谱系和卡片描述符。
2. 删除 coding-agent 的内置图像工具、RuntimeHost 的 `imageBackend` 与 desktop-app 的图像领域服务。
3. SDK 提供两个领域无关能力：
   - `ctx.network.request`：主进程代理 HTTP(S)、JSON/multipart 请求和 json/text/base64 响应。
   - `ctx.storage`：插件 id 隔离的 JSON、文件和 blob 持久化；blob 返回宿主媒体 URL。
4. 输入动作通过 `PluginPromptDecoration.instructions` 贡献隐藏指令；coding-agent 只识别通用 `pluginInstructions`，不再识别 `imageMode` / `editImageId`。
5. 网络与存储调用必须经过插件 capability session；主进程从 session 注入插件 id，并在 capability 层执行权限检查和审计。
6. 插件私有数据统一写入 `~/.vetta/plugin-data/<plugin-id>/`；首次访问时复制旧 `plugin-images` 数据，再由 image-gen 迁移旧索引，保留已有图像 id 和谱系。
7. 下一轮业务上下文使用通用 `PluginPromptAttachment`（label/icon/instructions/metadata）；宿主不再持有编辑图片专用状态。
8. 本地图片编辑通过 `fs.readBinaryFile` 读取受控原始字节并嗅探 MIME，不复用文本预览读取。

## 结果

- 禁用或卸载 image-gen 会同时移除工具和 UI，不再留下宿主内置能力。
- 新插件可复用网络、私有存储、动态工具、隐藏提示和消息卡片，无需向 desktop-app 增加领域 facade。
- 插件仍运行在可信 renderer 模型内；本 ADR 不引入 iframe/worker 安全边界。网络、存储和文件能力由 manifest、capability session 与主进程 provider 三层门控。
