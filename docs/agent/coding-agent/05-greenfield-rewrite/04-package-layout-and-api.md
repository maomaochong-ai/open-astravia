# 包布局与公开 API

## 1. 新目录布局

最终布局建议如下：

```text
packages/runtime-core/src/
  session/
    agent-session.ts
    session-state.ts
    input-queue.ts
  turn/
    turn-pipeline.ts
    turn-context.ts
    turn-runner.ts
    turn-engine-port.ts
  features/
    contracts.ts
    compiler.ts
    lifecycle.ts
  context/
    context-builder.ts
    context-strategy.ts
  tools/
    contracts.ts
    tool-runtime.ts
    tool-policy.ts
  storage/
    conversation-repository.ts
  events/
    session-events.ts
  index.ts

packages/runtime-storage/src/
  conversation/
    file-conversation-repository.ts
    event-codec.ts
    snapshot-codec.ts
    v1-importer.ts
  auth/
  settings/
  index.ts

packages/runtime-tools/src/
  coding/
    shared/
      anchors.ts
      path-resolution.ts
      text-decoding.ts
      truncation.ts
    host/
      executable-resolver.ts
      index.ts
    coding-tool-catalog.ts
    tool-registration.ts
    tools/
      current-time/
        current-time-tool.ts
        description.ts
        registration.ts
        index.ts
      grep/
        grep-tool.ts
        description.ts
        registration.ts
        index.ts
      find/
        find-tool.ts
        description.ts
        registration.ts
        index.ts
      glob/
        glob-tool.ts
        description.ts
        registration.ts
        index.ts
      ls/
        ls-tool.ts
        description.ts
        registration.ts
        index.ts
      read/
        read-tool.ts
        description.ts
        registration.ts
        image-mime.ts
        image-resize.ts
        photon.ts
        index.ts
    coding-tools-feature.ts
    index.ts
  index.ts

packages/runtime-mcp/src/
  client/
  config/
  oauth/
  mcp-tool-adapter.ts
  mcp-feature.ts
  index.ts

packages/coding-agent/src/
  profile/
    coding-profile.ts
    coding-instructions.ts
    default-features.ts
  adapters/
    sdk.ts
    rpc.ts
    cli.ts
  create-coding-agent.ts
  index.ts
```

入口文件只做导出和装配。解析、状态、存储、工具和协议实现必须位于其职责目录。

迁移期间允许包根继续导出旧工具，但新实现只从明确的
`@vetta/runtime-tools/coding` 子入口发布。每迁移一个工具，都必须先在该目录形成
独立实现和 Feature 合同测试，不能从新子入口转发 `coding-agent`。合同测试必须同时运行
旧实现与新实现，比较 Schema、模型描述、结果、错误和副作用；只完成其中一部分时不能公开
同名工具。

每个工具使用独立 `tools/<tool-name>/` 目录。模型可见描述使用 `description.ts` 导出常量，
不在工具实现中内联长字符串，也不重复旧实现的 `description.txt -> generated TS` 构建步骤。

工具可以依赖包内纯行为模块，但不能通过共享模块重新形成“工具大全”。当前 read 提取的
路径解析、文本解码、锚点和截断只包含无状态算法；文件系统、图片解码和 Runtime 合同仍由
read 自己装配。后续工具只有在确实共享同一行为合同时才复用这些模块。

read 对外暴露两类 Port：

```text
ReadOperations
  stat / readFile / detectMime

ReadImageProcessor
  processImage
```

默认 Adapter 保持旧文件系统、`file-type` 和 Photon/WASM 行为，测试或其他宿主可以注入实现。
Port 的目的仅是隔离环境依赖，不允许 Adapter 修改模型可见结果。新实现不从
`coding-agent` 导入任何生产代码。

工具执行定义与 Coding 产品注册元数据必须分离：

```text
RuntimeToolDefinition
  name / label / description / inputSchema / execute

CodingToolRegistration
  tool / scopeUse / category
```

`RuntimeToolDefinition` 属于通用 Kernel 合同，不认识 `project`、`im-claw` 或 `cli`。
`scopeUse` 和 `category` 位于 `runtime-tools/coding` 注册层。组合根创建工具注册并放入
`CodingToolRegistry`，Feature 在每次模型调用前读取一个版本化 Catalog Snapshot 后筛选。
Agent Profile ID 与会话场景是两个概念，不能通过比较 `profileId === scope` 隐式绑定。

空 `scopeUse` 也必须保留其语义。旧 `ls` 使用空数组表达“工具可用，但默认不在任何场景
激活”。迁移后不能为了让测试容易通过而把它改成全场景默认启用。Catalog 持有完整注册集合，
Model Call Frame 只包含该次模型调用激活的 Tool；激活状态不能进入
`RuntimeToolDefinition`。

`CodingToolsFeatureOptions` 不暴露具体工具 Options：

```ts
interface CodingToolsFeatureOptions {
	readonly catalog: CodingToolCatalog;
	readonly activation?: CodingToolActivation;
}
```

工具自己的依赖在注册时注入：

```text
createReadToolRegistration(cwd, readOptions)
createLsToolRegistration(cwd, lsOptions)
  -> CodingToolRegistry.register()
  -> CodingToolCatalog.snapshot()
  -> CodingToolsFeature
  -> ModelCallContributionProvider
  -> ModelCallFrame
```

Catalog 把读取能力与修改能力分开：

```text
CodingToolCatalog
  snapshot()
  resolve(toolName)
  execute(binding, request)

CodingToolRegistry extends CodingToolCatalog
  register()
  activate()
  deactivate()
  revoke()
  unregister()
```

Feature 只依赖只读 Catalog，不能注册或删除工具。Registry 每次有效修改增加版本并使后续
Catalog Snapshot 反映新成员。Feature prepare 只创建长生命周期的
`ModelCallContributionProvider`，不绑定某一版成员列表：

```text
register / unregister
  -> Catalog version 变化
  -> 下一次模型调用重新物化 Model Call Frame
```

因此工具成员变化不需要重新 prepare 全部 Feature，也不需要重建 Runtime Snapshot。
`resolve(toolName)` 返回包含 `CapabilityBinding` 的只读 Entry，供 Model Call Frame 建立执行
句柄；真正执行必须调用 `execute(binding, request)`，由 Catalog 在一个同步临界区内校验
source、capability、revision 和状态并登记 in-flight execution。若工具已删除则返回可恢复
错误；若同名工具已替换，旧 Schema 产生的调用不能误路由到新实现。Feature 拓扑、
Context Strategy 或 Observer 变化仍通过重新编译和
`AtomicRuntimeSnapshotProvider.swap()` 发布。

Catalog Entry 状态分为 `active`、`deactivated` 和 `revoked`。Snapshot 只公开 active Entry：

- `deactivate` 隐藏能力并拒绝尚未开始的调用，不终止在途执行，后续 `activate` 复用原
  revision。
- `revoke` 用于权限或安全撤销，轮换 revision 并通过执行跟踪器协作取消所有在途调用。
- `unregister` 删除成员，但不把普通热卸载误解为强制取消已经开始的副作用。
- 同名工具注销后重新注册会获得新 revision，旧绑定稳定返回 definition changed。

运行时错误通过稳定结构传递：

```text
CodingToolAvailabilityError
  -> RuntimeToolExecutionError { code, retryable, metadata }
  -> AgentToolExecutionError
  -> ToolResultMessage.details
```

错误文本仍保留给模型和日志；宿主、重试策略和测试使用结构化 details，不解析自然语言。

激活合同分为两种：

- `mode: "scope"`：按场景默认激活，可用 `additionallyEnabledToolNames` 增加空 scope 工具。
- `mode: "explicit"`：显式工具名集合完全替代场景默认集合。

未知工具名 fail-closed，不会凭空创建工具。

## 2. 公开 API 收缩

新 `@vetta/coding-agent` 根入口建议只导出：

```ts
export {
	createCodingAgent,
	type CodingAgent,
	type CodingAgentOptions,
	type CodingAgentSession,
	type SessionEvent,
	type SessionInput,
	type TurnResult,
} from "...";
```

可选的明确子入口：

```text
@vetta/coding-agent/cli
@vetta/coding-agent/rpc
@vetta/coding-agent/testing
```

不再从根入口导出：

- `SessionManager`。
- `SettingsManager`。
- `ModelRegistry`。
- `McpManager`。
- Tool 工厂。
- Extension Runner。
- Resource Loader。
- Knowledge 内部函数。

真正需要复用的实现必须移动到其所有权包并从该包导出。不能为了方便再次从 `coding-agent` 聚合导出。
