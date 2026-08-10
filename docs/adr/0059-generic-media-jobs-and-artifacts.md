# ADR-0059：通用媒体操作、宿主任务与临时产物

## 状态

已采纳。取代 ADR-0057 的媒体协议 v2；媒体协议当前版本为 v4。

## 背景

媒体协议 v2 以图片和视频“生成任务”为中心，把创建、查询、取消、产物保存和释放都放在 `ctx.media`。这个模型能接远程生成服务，但会把后续的合成、转码、导出等能力强行伪装成生成，也让任务生命周期和产物生命周期无法被其他耗时能力复用。

Remotion 暴露了问题，但不是协议的设计中心：公共 API 不应包含 composition id、React props、bundle 路径或 Remotion codec 等实现字段。其他时间线引擎、FFmpeg 或云端渲染服务也必须能使用同一边界。

## 决策

### 1. 媒体域只负责能力发现与提交

`ctx.media` 只暴露 `listProviders()`、`onProvidersChanged()`、`submit()` 和 Provider 注册。提交请求是按 `operation` 判别的联合：

- `generate`：提示词驱动的图片或视频生成；
- `compose`：把一个有 MIME 类型的工程文档及其素材合成为媒体；
- `transcode`：把单个有 MIME 类型的媒体输入转换为目标格式。

Provider 用同样的判别联合声明能力。`compose` 按接受的工程 MIME 与输出 MIME 匹配，`transcode` 按输入、输出 MIME 匹配。公共协议不认识具体引擎。

生成 Provider 除 `modes` 外可用 `modeCapabilities` 声明每种模式的语义输入槽：稳定的 `role`、接受的媒体 kind、单槽与总数量上下限，以及比例和音频策略。提交输入携带相同 `role`，宿主在不透明化与转发时保留它。这样“首帧/尾帧”和“图片/视频/音频参考”等创作语义可以跨宿主与 Provider 对齐，同时不暴露 ComfyUI 节点名、云厂商字段或文件路径。旧 Provider 只声明 `modes` 时，消费方可继续使用既有的模式级默认规则。

### 2. 任务成为 Foundation Capability

媒体提交返回宿主生成的通用 `Job`：`id`、`domain`、`operation`、`status`、结构化进度、临时产物、元数据和错误。`ctx.jobs` 统一提供 `get()`、`wait()` 与 `cancel()`。

Provider 自己的队列 ID 只保存在宿主 driver 闭包中，不作为公共任务身份。任务按消费插件 owner 隔离，插件不能查询或取消其他插件的任务。Job 与临时产物绑定稳定的插件 owner，而不是 renderer capability session，因此页面刷新后的新 session 可以继续查询原 Job。Provider 卸载会中止当时尚未完成的调用；同 ID Provider 重新注册后，宿主 driver 可用原队列 ID 向新实例继续查询。

JobManager 仍是主进程内存状态；如果主进程重启或调用方恢复了遗留 ID，`get` / `cancel` 返回 `failed`、错误码为 `job-not-found` 的终态 Job，而不是抛出 Provider 异常或无限重试。跨主进程重启恢复远端队列不在本 ADR 的保证范围内。

### 3. 临时产物成为 Foundation Capability

所有成功输出先进入宿主管理的不可变临时产物存储，并返回 `ArtifactRef`。`ctx.artifacts.persist()` 把它复制到插件 Blob 或工作区文件，`release()` 只释放临时副本。

产物按消费插件 owner 隔离。Provider 不能选择最终保存位置，也不能把输出写进另一个插件的命名空间。媒体元数据是通用产物引用上的领域扩展，不改变持久化协议。

### 4. Provider 传输与执行方式解耦

Provider 输入只包含不透明 input id、语义 role、kind 与 MIME。远程 Provider 可在单次调用上下文用 `uploadInput()` 流式上传；Provider 输出可引用远程 URL、自己的插件 Blob 或有权限读取的工作区文件，宿主统一导入为消费方临时产物。

注册本地 Provider 不再强制 `network.fetch`。只有实际使用远程 URL 或上传时才检查网络权限；插件 Blob 和工作区文件分别检查 `storage.read` 与 `fs.read`。

### 5. Remotion 作为 compose Provider

Remotion Provider 声明自己接受的工程文档 MIME（例如插件私有的 `application/vnd.example.remotion-project+json`）与输出 MIME。消费方提交该文档和素材，Provider 内部负责 bundle、选择 composition、校验 props、渲染以及把输出文件交回宿主。

composition、React 组件、Remotion 版本和渲染选项属于工程文档 schema 或 Provider 配置，不进入 Vetta 公共类型。以后替换为其他渲染引擎时，只需注册接受相应工程 MIME 的 `compose` Provider。

## 结果

- 删除媒体协议 v2 的 `createJob/getJob/cancelJob/saveArtifact/releaseArtifact`，不保留并列入口。
- 图片生成、ComfyUI 和内容创作迁移到 `media.submit + jobs + artifacts`。
- 宿主可以复用任务和产物基础设施承载非媒体耗时能力。
- 接入 Remotion 仍需要一个 Provider 实现和工程文档 schema，但不再需要修改公共插件 API。
