# 媒体 Provider 协议

`ctx.media` 是宿主底层媒体能力的插件适配面。消费者只描述要生成什么，不依赖具体模型、供应商、网关或本地实现；Provider 由宿主模块注册，列表允许为空。

## 消费媒体能力

需要 `media.generate` 权限。先按能力选择 Provider，再创建任务：

```ts
const provider = (await ctx.media.listProviders())
  .find((item) => item.capabilities.some(
    (capability) => capability.kind === "image" && capability.modes.includes("text-to-image"),
  ));

if (!provider) throw new Error("No image provider available");

const job = await ctx.media.createJob({
  providerId: provider.id,
  kind: "image",
  mode: "text-to-image",
  prompt: "a red fox in snow",
  dimensions: { width: 1024, height: 1024 },
});
```

任务状态为 `queued | running | succeeded | failed | cancelled`。异步 Provider 返回非终态后，消费者用 `getJob()` 轮询，并可用 `cancelJob()` 请求取消。Provider 不支持相应操作时返回 `operation-unsupported`。

输入素材通过句柄传递，不再嵌入 base64。插件私有素材使用 `plugin-blob`，工作区文件使用 `workspace-file`：

```ts
references: [
  { kind: "image", source: { type: "plugin-blob", blobId: image.id } },
  { kind: "audio", source: { type: "workspace-file", path: audioPath } },
]
```

成功结果的 `artifacts[]` 也是宿主管理的临时句柄，只包含 ID、MIME、大小和媒体元数据。插件必须明确选择保存位置，并在使用完成后释放临时产物：

```ts
const artifact = job.artifacts?.[0];
if (!artifact) throw new Error("Media provider returned no artifact");

try {
  const saved = await ctx.media.saveArtifact({
    artifactId: artifact.id,
    destination: { type: "plugin-blob" },
  });
  // saved.blobId / saved.url can be stored in plugin state.
} finally {
  await ctx.media.releaseArtifact(artifact.id);
}
```

`plugin-blob` 读写分别要求 `storage.read` / `storage.write`，`workspace-file` 读写分别要求 `fs.read` / `fs.write`。字节始终由宿主在主进程内按需读取或复制，不经过插件渲染进程；`releaseArtifact()` 只释放临时产物，不删除已经保存的文件或 Blob。

## 宿主 Provider SPI

通用媒体契约和 capability token 定义在 `@vetta/capability-sdk`，当前协议版本为 2。注册表、临时产物存储及 Provider SPI 位于 desktop 主进程。Provider 不是插件贡献点，`ctx.media` 不提供 `registerProvider()`，也不存在 `media.provider.register` 权限。

新增图片或视频实现时，在主进程注册一个宿主 Provider，并绑定 `cap.domain.vetta.media.*` 能力。它可以调用远端服务、本地模型或 sidecar；消费者契约无需改变。Provider 的生命周期由宿主管理，注销时会中止仍在执行的调用。

## Desktop 内置 Vetta Provider

desktop-app 默认注册 `desktop-app:vetta`，当前支持 `text-to-image` 与 `image-to-image`。它的实现位于主进程：renderer 只提交媒体协议请求，主进程固定选择 `images/generate` 或 `images/edit`，并负责注入 JWT 与刷新凭据。插件拿不到用户 token，也不能通过该接口传入任意网关路径。

该内置实现不是底层协议的前提。没有它的宿主构建仍可暴露一个空 Registry；消费者必须处理 `listProviders()` 为空和 `provider-unavailable`。
