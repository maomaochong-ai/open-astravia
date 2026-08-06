# ADR-0057：宿主媒体协议与 desktop 内置 Vetta Provider

## 状态

已采纳。取代 ADR-0056 中由 `image-gen` 直接调用 `ctx.gateway` 的客户端分层；服务端模型选择、鉴权和积分计费决策不变。

## 背景

图片与视频生成实现可能来自 Vetta 网关、本地模型或 sidecar。若消费者直接依赖某个插件或 HTTP 形态，不同调用方之间没有稳定契约，也无法明确谁负责持久化。把 Vetta 网关实现做成 Provider 插件虽能复用协议，但它仍运行在共享 renderer realm，安全边界弱于宿主主进程，也会把本应通用于桌面端的能力错误地绑定到插件生命周期。

## 决策

### 1. 媒体生成下沉为 Domain Capability

`@vetta/capability-sdk` 定义图片与视频的能力发现、任务创建、查询、取消、进度、产物、结构化错误及四个 `cap.domain.vetta.media.*` token。Provider Registry 允许为空；任何消费者都不能假定宿主一定具备生成能力。

Provider SPI 和 Registry 由 desktop 主进程拥有，Provider 只能由宿主模块注册。插件 SDK 仅把底层能力适配为受 `media.generate` 门控的 `ctx.media` 消费 API，不暴露 Provider 注册权限或实现回调。

### 2. Vetta 图片 Provider 内置于 desktop-app

默认 Provider ID 为 `desktop-app:vetta`。renderer 只传通用 `MediaCreateJobInput`，主进程校验 capability session 与 `media.generate` 权限，并把请求映射到固定的 `images/generate` 或 `images/edit` 端点。

JWT、刷新流程、服务端地址和网关路径均由主进程掌握。媒体 API 不接受 path、URL、header 或 token，因而不会把通用登录网关能力暴露给媒体消费者。

当前内置实现只声明文生图与图改图。协议中的视频任务先保留，无内置视频 Provider；以后接入异步服务时无需修改消费者契约。

### 3. 消费者拥有持久化

Provider 返回 base64 产物，协议不自动落盘。消费者决定是否以及如何调用自己的 `ctx.storage` 保存，因此 `image-gen` 的记录和 blob 继续位于 `~/.vetta/plugin-data/image-gen/`。Provider 无法借此把数据写入另一个插件的命名空间。

## 安全边界

本决策缩小的是媒体调用面：普通媒体消费者无法读取 JWT，也无法借媒体 API 调用任意 Vetta 端点。它不等于完整插件沙箱；当前插件仍与宿主 renderer 共享 JavaScript realm，preload 暴露面需要后续通过隔离执行环境和更窄的桥接继续治理。

## 结果

- `image-gen` 只依赖 `ctx.media` 与自身 `ctx.storage`，不再依赖 `ctx.gateway`。
- Vetta Provider 不再作为独立插件进入租户清单，禁用普通插件不会移除宿主默认实现。
- 新 Provider 以宿主模块形式按同一 SPI 扩展图片或视频；没有任何 Provider 时返回稳定的不可用结果。
