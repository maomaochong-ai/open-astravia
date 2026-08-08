# ADR-0057：宿主媒体协议与 desktop 内置 Vetta Provider

## 状态

已被 ADR-0059 取代。由本 ADR 建立的 Provider Registry 与主进程 Vetta Provider 保留，媒体任务和产物 API 已重构。

## 背景

图片与视频生成实现可能来自 Vetta 网关、本地模型或 sidecar。若消费者直接依赖某个插件或 HTTP 形态，不同调用方之间没有稳定契约，也无法明确谁负责持久化。Vetta 网关实现涉及宿主 JWT，必须留在主进程；本地或第三方服务则需要可安装的 Provider 适配层，且不能让消费者感知 ComfyUI 节点等实现字段。

## 决策

### 1. 媒体生成下沉为 Domain Capability

`@vetta/capability-sdk` 定义图片与视频的能力发现、任务创建、查询、取消、进度、产物、结构化错误及四个 `cap.domain.vetta.media.*` token。Provider Registry 允许为空；任何消费者都不能假定宿主一定具备生成能力。

Registry 与产物存储由 desktop 主进程拥有。插件 SDK 对消费方暴露受 `media.generate` 门控的稳定请求；对 Provider 插件暴露受 `media.provider.register` 门控的注册回调。两者共用同一 Registry。

### 2. 插件 Provider 通过受控桥接注册

Provider 插件只接收统一的提示词、比例、尺寸、时长和不透明素材引用。素材真实路径与 Blob 命名空间不会进入 renderer；Provider 只能在当前任务上下文调用 `uploadReference()`，由主进程把文件流式上传到插件指定的 HTTP(S) 端点。Provider 返回远程产物描述，主进程再流式下载为临时产物句柄。

插件负责服务特有的工作流发现、字段映射、提交、轮询与取消。消费者不传工作流 ID、节点 ID、URL、header 或其它底层字段。Provider 增删通过事件通知消费插件，避免并行激活产生加载顺序竞态。

### 3. Vetta 图片 Provider 内置于 desktop-app

默认 Provider ID 为 `desktop-app:vetta`。renderer 只传通用 `MediaCreateJobInput`，主进程校验 capability session 与 `media.generate` 权限，并把请求映射到固定的 `images/generate` 或 `images/edit` 端点。

JWT、刷新流程、服务端地址和网关路径均由主进程掌握。媒体 API 不接受 path、URL、header 或 token，因而不会把通用登录网关能力暴露给媒体消费者。

当前内置实现只声明文生图与图改图。协议中的视频任务先保留，无内置视频 Provider；以后接入异步服务时无需修改消费者契约。

### 4. 消费者拥有持久化

Provider 返回宿主管理的临时产物句柄，协议不自动写入消费者存储。消费者决定是否以及如何调用 `saveArtifact()` 保存，再调用 `releaseArtifact()` 释放临时文件。Provider 无法借此把数据写入另一个插件的命名空间。

## 安全边界

本决策缩小的是媒体调用面：普通媒体消费者无法读取 JWT，也无法借媒体 API 调用任意 Vetta 端点；Provider 插件看不到输入素材路径，只能通过单次调用上下文传输已引用的素材。它不等于完整插件沙箱；Provider 插件仍具备其显式申请的 `network.fetch` 权限。

## 结果

- `image-gen` 只依赖 `ctx.media` 与自身 `ctx.storage`，不再依赖 `ctx.gateway`。
- Vetta Provider 不再作为独立插件进入租户清单，禁用普通插件不会移除宿主默认实现。
- 新 Provider 可按所需权限边界选择宿主模块或插件实现；没有任何 Provider 时返回稳定的不可用结果。
- 内容创作等消费者只依赖统一参数，ComfyUI 工作流和节点字段由 Provider 插件内部适配。
