# 阶段 35：活动 Turn 输入并发语义

## 目标

在不切换生产入口的前提下，为 Greenfield Session 补齐旧 AgentSession 的活动 Turn 输入语义：
显式区分 steer 与 follow-up，支持 `one-at-a-time` / `all` 队列模式，并保持自然结束、取消、错误和
关闭时的既有行为边界。

## 旧行为基线

旧实现由 Coding Agent 的 `InputPipeline`、`QueueController` 和 Agent Core 模型循环共同决定：

- 活动 Turn 中再次 prompt 且未指定 `streamingBehavior` 时拒绝；
- steer 在当前模型/工具循环的下一个 steering 检查点进入上下文；
- follow-up 只在一次自然响应结束后进入后续模型调用；
- 两类队列相互独立、保持 FIFO，默认每次取一条，也可配置为一次取全部；
- assistant 以 `aborted` / `error` 结束时不继续取 follow-up；
- abort/error 不主动清空尚未消费的队列，Session close 则释放队列；
- 已消费的排队输入成为真实 user message，未消费输入不提前写入会话历史。

## 架构结论

输入队列属于 Session 的运行态，而不是 Turn Pipeline 的固定阶段，也不是模型 Provider 的职责。
实现采用以下依赖方向：

```text
AgentSession
  -> SessionInputQueue（队列状态与消费模式）
  -> TurnInputQueue Port（模型循环只读消费合同）
  -> TurnPipeline（仅透传）
  -> AgentCoreTurnEngine
  -> agent-core steering / continuation callbacks
```

`TurnInputQueue` 只暴露 `takeSteering()` 和 `takeFollowUps()`。模型循环看不到 enqueue、clear、模式修改
或 Session 生命周期，因此不能反向控制输入并发策略。

## 已实施

1. 新增 `SessionInputQueue`：
   - steer 与 follow-up 使用独立 FIFO；
   - 默认 `one-at-a-time`，支持运行时切换到 `all`；
   - 提供 pending、只读副本、clear 和分别消费；
   - 不依赖宿主、存储或 Agent Core 具体类。
2. 扩展 Greenfield `AgentSession`：
   - 空闲时 `send()` 正常启动 Turn，即使调用方携带 `streamingBehavior`；
   - 活动 Turn 未指定行为继续返回 `SESSION_BUSY`；
   - 指定行为时立即返回结构化 `queued` 回执；
   - 提供 `steer()`、`followUp()`、模式设置、pending 查询和 `clearQueue()`；
   - cancel 后保留未消费输入，close 时清空。
3. 扩展 Turn Engine 合同：
   - `TurnEngineRequest` 可携带窄化后的 `TurnInputQueue`；
   - Turn Pipeline 不拥有队列，只负责把当前 Session 的队列传给 Engine。
4. 接入 `AgentCoreTurnEngine`：
   - steering callback 对应 `takeSteering()`；
   - continuation callback 对应 `takeFollowUps()`；
   - 排队输入实际被模型循环接收时输出规范 user message，随后由 Pipeline 持久化；
   - error/aborted 终态沿用 Agent Core 的提前终止规则，不消费 follow-up。

## TypeBox / Zod 判断

本阶段没有引入 TypeBox 或 Zod。队列输入已经是 Kernel 内部的 `SessionInput/UserMessage`，不是 JSON、
RPC、配置文件或插件等不可信边界；在这里重复做运行时 Schema 校验只会把协议解析职责混入内核。
未来 Greenfield Session Backend 接收宿主请求时，应在 Backend/Adapter 边界校验外部 payload，再转换为
本阶段的类型合同。

## 测试覆盖

- 默认逐条消费、FIFO 和 steer/follow-up 队列隔离。
- `all` 模式与运行时模式切换。
- pending、只读查询和 clear。
- 活动 Turn 无显式行为时拒绝。
- 活动 Turn 的 steer/follow-up 回执与 pending 数量。
- 空闲时携带 `streamingBehavior` 仍启动正常 Turn。
- cancel 保留未消费队列，close 清空队列。
- 真实 Agent Core 循环先消费 steer、自然结束后再消费 follow-up。
- 已消费 user message 作为规范 Engine Message 输出。
- assistant error 后不消费 follow-up。

## 明确未修改

- 没有修改旧 Coding Agent 的 prompt 展开、图片处理或扩展命令行为；这些属于输入 Adapter。
- 没有改变模型、工具、Context Strategy、Runtime Snapshot 或会话文件格式。
- 没有把“进入队列”本身持久化；只有模型循环真正消费后才记录 user message。
- 没有切换 RuntimeHost、CLI、Desktop、RPC 或 IM 的生产 Session Backend。
- 没有实现队列跨进程恢复；旧实现本身也是进程内队列。

## 验证

- 定向 Vitest：3 个文件、17/17 通过。
- `bun run test:pkg runtime-core`：9 个测试文件、43/43 通过。
- `bunx tsgo --noEmit -p packages/runtime-core/tsconfig.build.json`：通过。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：本阶段源码、测试、Biome 和架构守卫通过；全量类型检查仍被既有基线问题阻断：
  - `packages/capability-runtime/test/registry.test.ts` fixture 缺少 `workspacePath` / `archivedProjects`；
  - `packages/runtime-tools/test/**` 的 5 处旧差分 fixture 存在 `AgentTool` 参数方差错误。

## 下一步

下一阶段建立 `GreenfieldRuntimeSessionBackend`：把现有 `RuntimeSessionBackend` 的 prompt/continue/abort、
事件订阅和状态查询适配到本阶段的 AgentSession 与阶段 34 的 SessionEvent Adapter。先以并行、显式选择的
组合根运行兼容合同，不能直接替换默认 `LegacyCodingAgentSessionBackend`。同时需要定义未完成 Turn 的
Repository 恢复策略；该策略不应把进程内未消费队列伪造成已持久化用户消息。
