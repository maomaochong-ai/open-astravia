# 媒体 Provider 协议

`ctx.media` 是宿主底层媒体能力的插件适配面。消费者只描述要生成什么，不依赖具体模型、供应商、网关或本地实现；Provider 可以由宿主模块或插件注册，列表允许为空。

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

消费插件可用 `onProvidersChanged()` 监听 Provider 增删，并重新执行能力发现。插件并行激活时不能依赖固定加载顺序。

## 注册 Provider

Provider 插件需要 `media.provider.register` 与 `network.fetch` 权限。注册项只声明统一的媒体能力和任务回调；服务特有的工作流、节点字段、鉴权和队列结构都留在插件内部：

```ts
ctx.media.registerProvider({
  id: "local-video",
  displayName: "Local video",
  capabilities: [{
    kind: "video",
    modes: ["image-to-video"],
    aspectRatios: ["16:9", "9:16"],
    durationsSeconds: [5, 10],
  }],
  async createJob(request, context) {
    const image = request.references.find((item) => item.kind === "image");
    if (!image) throw new Error("An image is required");
    await context.uploadReference(image.id, {
      url: "http://127.0.0.1:8188/upload/image",
      fieldName: "image",
    });
    // Adapt request.prompt / aspectRatio / durationSeconds inside the provider.
    return { id: "provider-job-id", status: "queued" };
  },
  async getJob(jobId) {
    return {
      id: jobId,
      status: "succeeded",
      artifacts: [{
        kind: "video",
        source: { type: "remote-url", url: "http://127.0.0.1:8188/view?..." },
      }],
    };
  },
});
```

Provider 收到的 `references` 只有不透明 ID、媒体类型和 MIME，不包含插件 Blob 命名空间或工作区路径。只有当前任务上下文能用 `uploadReference()` 把对应文件流式上传到 HTTP(S) 服务。Provider 返回的远程产物也由主进程流式下载并转换为宿主临时句柄；输入和输出都不经过 renderer Base64。

## Provider SPI

通用媒体契约和 capability token 定义在 `@vetta/capability-sdk`，当前协议版本为 2。注册表、临时产物存储、引用解析与网络传输位于 desktop 主进程。插件 Provider 通过受控 IPC 回调桥接到同一个 Registry，注销时会中止仍在执行的调用。

需要宿主凭据或其它主进程特权的实现仍应注册为宿主 Provider；普通远端服务、本地模型或 sidecar 可用 Provider 插件适配。两者对消费者暴露同一契约。

## Desktop 内置 Vetta Provider

desktop-app 默认注册 `desktop-app:vetta`，当前支持 `text-to-image` 与 `image-to-image`。它的实现位于主进程：renderer 只提交媒体协议请求，主进程固定选择 `images/generate` 或 `images/edit`，并负责注入 JWT 与刷新凭据。插件拿不到用户 token，也不能通过该接口传入任意网关路径。

该内置实现不是底层协议的前提。没有它的宿主构建仍可暴露一个空 Registry；消费者必须处理 `listProviders()` 为空和 `provider-unavailable`。
