# 第 55 轮：Greenfield 并行 Runtime 组合

## 目标

在不切换 Desktop、CLI 或 SDK 默认生产入口的前提下，建立第一条真实可执行的 Greenfield 纵向链路：

```text
CLI 显式 Composition Root
  -> Coding Agent Model / Prompt Adapter
  -> Greenfield Session Backend
  -> 通用 Runtime Factory
  -> AgentSession -> TurnPipeline -> Agent Core
  -> Runtime Coding Tools
  -> FileConversationRepository
```

本轮验证的不是新功能，而是已迁移基础能力能否在真实组合中协同工作。Legacy 仍是默认生产实现。

## 分析结论

### 1. 通用工厂属于 Runtime Core，产品资源选择属于应用组合根

`AgentSession`、`TurnPipeline` 和 `AgentCoreTurnEngine` 是 Runtime-owned 对象，组装规则应由
`runtime-core` 提供。文件目录、模型注册表、工具激活和工作目录是产品决策，由 `cli-app`
显式注入。这样工厂不依赖 Coding Agent，应用也不需要复制 Kernel 内部组装细节。

### 2. Model Runtime 必须同时服务 Session Port 和 Turn Pipeline

同一个 `GreenfieldRuntimeModel` 同时作为 Model Controller/View/State 的事实源和
`RuntimeTurnModelBindingProvider`。prompt 携带的 model/reasoning 先更新 Session Model Runtime，
随后 Turn Pipeline 冻结本 Turn 的模型绑定。凭证解析使用该精确模型，不能在流调用时再次读取
可能已经变化的“当前模型”。

这保持了旧行为：运行中的 Turn 不被后续切模影响；排队输入执行时使用真正开始该 Turn 时的模型。

### 3. Prompt Adapter 只能映射已经等价迁移的能力

本轮支持文本、图片、model、reasoning 和 streaming behavior。模型不支持图片时沿用旧
RuntimeHost 的省略图片与提示文本行为。

`promptRef`、attachments 和 metadata 尚未接入 Greenfield Context/Capability 管道，因此显式拒绝，
而不是静默丢弃。静默接受会制造“接口成功、功能消失”的兼容性缺陷。

### 4. `continue()` 是重试语义，不是从正常 assistant 终态续写

Agent Core 的既有合同要求 continue 前最后一条模型消息为 user 或 toolResult，主要用于失败/中断后的
无伪用户消息重试。从正常结束的 assistant 消息继续会被明确拒绝。本轮测试用持久化失败回合验证恢复和
continue，没有改变该功能语义。

### 5. Greenfield 需要窄公共入口

如果 CLI 从 `@vetta/coding-agent/runtime-host` 大桶入口导入两个 Greenfield Adapter，会连带加载
Legacy Session、平台 sandbox 和宿主模块。新增
`@vetta/coding-agent/runtime-host/greenfield` 窄入口，使并行组合只依赖模型与 prompt 适配器。

### 6. 本轮不需要 TypeBox 或 Zod

新增边界均由 TypeScript Composition Root 在进程内直接构造，没有解析配置文件、IPC 或不可信 JSON。
内部对象再做 Schema 校验只会重复静态类型。以后若 Greenfield Backend 选择、工具激活或模型配置来自
外部输入，应在对应输入边界使用 TypeBox/Zod。

## 已实施

### Runtime Core

- 新增通用 `ComposedGreenfieldRuntimeFactory`，从注入资源创建或恢复 AgentSession、TurnPipeline 和
  Agent Core Turn Engine，并在组装失败时释放会话资源。
- Turn Engine 增加按冻结模型解析 API Key 的 Port，避免切模与凭证错配。
- Greenfield Backend 在 prompt 前应用 model/reasoning，并复用旧图片能力降级语义。
- 包根和 runtime-host 子入口导出新的工厂合同。

### Coding Agent Adapter

- 新增 Model Registry Adapter，复用既有刷新、可用模型、精确查找、凭证、server token 和远端模型能力。
- 新增 Prompt Adapter，将已支持字段映射为 Runtime Session Input，对未迁移字段 fail closed。
- 新增窄公共入口 `@vetta/coding-agent/runtime-host/greenfield`，不要求消费者加载 Legacy 大桶入口。

### CLI 并行 Composition Root

- 新增显式 `createGreenfieldRuntimeComposition()`，组合真实
  `FileConversationRepository`、Runtime Coding Tools、Model Runtime、Snapshot 和 Backend。
- Tool 激活仍使用既有 registry/activation 规则，State Reader 动态读取当前有效工具名。
- 提供统一 dispose，释放文件仓储、编译 Snapshot 和工具运行时资源。
- 该入口只通过 API 显式调用，不替换 `runCli()`、`agent` 子命令或 Desktop 默认 RuntimeHost。

## 明确未修改

- 未切换 Desktop、CLI、RPC 或 SDK 的默认 Legacy Backend。
- 未改变 coding tool 的名称、描述、Schema、执行结果或激活规则。
- 未迁移 Skill、Knowledge、MCP、Prompt Attachment、Host Interaction、Execution Mode、
  Configuration、Todo、Background Work 和 Subagent 外围能力。
- 未删除 `runtime-tools` / `runtime-storage` 包根现有兼容代理。
- 未改变 Agent Core 的 continue 合同。

## 测试

新增或补充的验证包括：

- Turn 冻结模型与精确 API Key 解析一致。
- Greenfield prompt 的 model/reasoning 应用顺序和不支持图片时的旧行为。
- Model Registry Adapter 与 Prompt Adapter 的成功/拒绝路径。
- 真实文件 Repository、真实 `read` 工具、Tool Loop、持久化、完整会话恢复，以及失败回合
  resume 后不追加伪用户消息的 continue。
- CLI 组合只激活显式 `read` 工具，模型调用收到正确工具和凭证。

验证结果：

- `packages/runtime-core`：24 个测试文件、113 项测试全部通过。
- `packages/coding-agent` Greenfield Adapter 定向测试：2 个测试文件、3 项测试全部通过。
- `packages/cli-app`：2 个测试文件、10 项测试全部通过。
- 全仓 `tsgo --noEmit` 通过。
- `bun run check:quick` 与根目录 `bun run check` 通过。

## 下一步

下一阶段不应立即切换默认入口，而应完成“Greenfield 外围能力等价组合”这一整个阶段：

1. 按现有 Runtime Session Port，补齐 Host Interaction、Execution/Workspace、Configuration、
   Todo 和 Background Work 的 Greenfield 实现；不提供空实现。
2. 把 Skill、MCP、Knowledge 和 Prompt Attachment 作为 Capability/Context Provider 接入动态
   Model Call Frame，并建立和 Legacy 的输入、提示词、工具集合差分测试。
3. 为 create/resume/dispose、运行中动态能力变化和失败清理建立应用级生命周期测试。
4. 能力矩阵达到目标场景等价后，再增加可回退的显式灰度选择；默认入口切换应是后续独立决策。

`runtime-tools` / `runtime-storage` 包根兼容代理迁移仍应单独处理，不能和功能等价阶段混在一起。
