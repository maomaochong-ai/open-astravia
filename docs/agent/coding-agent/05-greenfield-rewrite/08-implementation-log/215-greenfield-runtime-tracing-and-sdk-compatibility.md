# 第 215 阶段：Greenfield Runtime Tracing 与 SDK 兼容闭合

## 阶段目标

本阶段恢复旧 SDK 已有的 `tracer`、`tracingTraceName` 和 `tracingMetadata` 功能，只重构接线边界，
不增加新的观测系统或改变既有 Agent Loop 行为：

1. SDK Host 继续支持显式注入平台中立 tracer；
2. 未显式注入时，继续由 `VETTA_TRACING=langfuse` 启用 Langfuse 适配器；
3. Greenfield Composition、Runtime Factory 和 Turn Engine 只传递中立合同；
4. 每个 Turn 使用真实的 Session ID，不复用创建 Composition 时的陈旧身份；
5. 根 Agent observation、LLM generation、Tool observation、内容捕获和 flush 继续复用 Agent Loop；
6. Session 和 Composition 不接管注入 tracer 的关闭职责；
7. 不处理自定义 Subagent Registry/Session Factory，也不切换公开 SDK 工厂。

## 实施前基线

Legacy `createAgentSession` 已有以下行为：

- `options.tracer` 优先于环境自动创建的 Langfuse tracer；
- 默认 `captureContent: true`、`detail: "standard"`；
- Trace Name 优先级为显式 option、`VETTA_TRACING_TRACE_NAME`、`"coding-agent run"`；
- 用户 metadata 之后追加 `app: "coding-agent"`、`cwd` 和真实 `sessionId`；
- Agent Loop 创建 `agent.run` 根 observation，并按 detail 创建 generation/tool 子 observation；
- 每次 Agent Loop 结束调用 `flush`，但 Session 不调用 tracer 的 `shutdown`。

Greenfield 路径此前把三个公开参数标记为 `not-wired`，SDK Host 会直接拒绝它们；Composition 和
`ComposedGreenfieldRuntimeFactory` 也没有 tracer 端口，因此真实 Turn 不会产生 observation。

## 架构决策

### 1. 具体后端只存在于产品 Host

`createLangfuseRuntimeTracerFromEnv` 只在 Coding Agent SDK Host 中调用。Runtime Core 没有增加
`@vetta/runtime-telemetry` 或 Langfuse 依赖，而是复用 `AgentLoopConfig["tracer"]` 和
`AgentLoopConfig["tracing"]` 的已有平台中立类型。

接线方向固定为：

```text
SDK Host（显式 tracer / Langfuse env / 默认策略）
  -> Coding Agent Composition（中立配置）
  -> ComposedGreenfieldRuntimeFactory（中立配置）
  -> AgentCoreTurnEngine（Turn 身份绑定）
  -> Agent Loop（observation 层级、内容、usage/cost、flush）
```

Runtime Core 不解析环境变量、不认识 Langfuse，也不创建第二套 Runtime Session observation。

### 2. Session ID 在 Turn 边界覆盖

Composition 可以同时创建根 Session 和多个子 Session，因此不能在 Composition 创建时固定观测身份。
`AgentCoreTurnEngine.createConfig` 为每次 `execute` 创建新的 tracing 配置，并用
`TurnEngineRequest.sessionId` 同时覆盖：

- Trace attributes 中的 `sessionId`；
- 根 observation metadata 中的 `sessionId`。

即使调用方 metadata 带有旧 `sessionId`，也不会污染当前 Turn。这个配置不是 Runtime Snapshot 的一部分，
不会因为工具、提示词或 Skill 的运行时变化而重建能力快照。

### 3. Tracer 是非所有权端口

显式 tracer 可能被多个 Session 或子 Composition 共享。Composition 只保存引用并传给 Turn Engine：

- Agent Loop 仍在每次运行结束后调用 `flush`；
- Session `close`/`dispose` 不调用 `shutdown`；
- Composition `dispose` 不调用 `shutdown`；
- tracer 的最终关闭由创建它的进程宿主负责。

子 Composition 继续通过既有 child policy 继承父级 tracer 和 tracing 策略，但 Turn Engine 会为子 Turn
写入子 Session 自己的身份。

### 4. 不引入 TypeBox 或 Zod

本阶段处理的是进程内已类型化的端口与简单配置，不存在需要在运行时解析的不可信 JSON、文件格式或协议
payload。TypeScript 合同足以约束接线；增加 TypeBox/Zod 只会重复类型定义，因此没有引入新的校验层。

## 本阶段实施记录

### Runtime Core

- `AgentCoreTurnEngineOptions` 增加平台中立的 `tracer` 和 `tracing`；
- 每次 Turn 构造独立 tracing 配置并覆盖真实 Session ID；
- `ComposedGreenfieldRuntimeFactoryOptions` 增加同类型端口并传入 Turn Engine；
- 没有修改 Agent Loop 的 observation 命名、层级、内容捕获、usage/cost 或 flush 实现。

### Coding Agent Composition

- `GreenfieldRuntimeCompositionOptions` 暴露中立 tracer 与 tracing policy；
- Composition Root 将两者传给 Runtime Factory；
- child composition policy 保留这两个允许继承的父级端口；
- Composition 生命周期没有登记 tracer dispose/shutdown 动作。

### SDK 产品宿主

- 显式 `options.tracer` 保持最高优先级；
- 未提供时继续调用既有 Langfuse 环境适配器；
- 恢复旧默认 `captureContent`、`detail`、Trace Name 优先级和 `app`/`cwd` metadata；
- Session ID 延迟到 Turn Engine 写入，避免根/子 Session 共用创建时身份；
- `tracer`、`tracingTraceName`、`tracingMetadata` 的兼容接线状态改为 `wired`；
- 尚未接线的 Subagent Session Factory 继续 fail closed。

## 测试与验证

新增或更新的测试覆盖：

- 同一 Composition 的两个 Session 分别产生自己的 `sessionId`；
- 用户 metadata 中的陈旧 Session ID 被当前 Turn 身份覆盖；
- Trace Name 和自定义 metadata 保留；
- generation observation 仍是 `agent.run` 的子 observation；
- 每个 Turn 调用一次 `flush`；
- Session 和 Composition 释放时不调用 tracer `shutdown`；
- child composition 继承 tracer 与 tracing policy；
- SDK Host 接受三个既有 Tracing 参数；
- SDK compatibility inventory 只继续拒绝尚未接线的 Subagent Factory。

验证结果：

- Coding Agent 定向测试：4 个文件、16 项测试通过；
- Runtime Core Turn Engine/Factory 回归：2 个文件、16 项测试通过；
- 修正测试夹具成功终态类型后，Tracing 贯通测试再次通过；
- `bun run check:quick`：通过；
- `bun run check`：通过，包含全仓 Biome、monorepo/CLI/Desktop/Admin 类型检查和全部架构门禁。

## 阶段结论

第 215 阶段已经闭合 Greenfield SDK 的 Tracing 创建参数。具体观测后端留在产品 Host，中立配置沿
Composition 和 Factory 单向传递，真实 Session 身份在 Turn 边界绑定，Agent Loop 继续独占执行细节。
这保持了旧功能，同时避免把 Langfuse、生命周期所有权或观测实现泄漏到 Runtime 内核。

下一阶段应单独处理 `subagentTypeRegistry`、`subagentSessionFactory` 以及固定 Session 门面的
`listSubagents`、`interruptSubagent`、`clearFinishedSubagents`，并继续保持产品适配器与 Runtime Subagent
端口之间的边界。
