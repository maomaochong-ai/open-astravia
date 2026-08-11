# Phase 5A：Engine 与 Runtime 行为对齐

> 历史状态说明：本页记录生产切换前的差距审计；其中“尚未完成”事项已在 [Phase 5B](./12-phase-5b-stateless-runtime-adapter.md) 和 [Phase 5C](./13-phase-5c-production-switch.md) 继续实施。

## 目标

在修改生产 `AgentCoreTurnEngine` 组合根之前，逐项比较 legacy `agentLoopContinue()` 与新 `runAgentTurn()` 的产品语义，先关闭会导致能力丢失的 Engine 缺口。

本批只修改 `packages/agent` 的新 Engine 和测试，不切换 Runtime 生产路径，也不删除 legacy loop。

## 审计维度

比对覆盖：

- steering 的轮询时机、剩余工具中断和消息顺序。
- follow-up/continuation 的消费条件和一批一轮顺序。
- 工具 update、phase、开始时间、耗时与最终 phase 列表。
- model-call、assistant-result、assistant-error checkpoint 的顺序。
- Provider 瞬态调用视图与后续 Agent 上下文的所有权。
- 动态工具快照、取消、有限预算和结构化工具错误。
- Runtime message envelope、Frame、salvage、telemetry 与 observation 的适配需求。

## 发现的问题

### 输入队列缺失

新 Engine 原先没有 steering 和 continuation 端口。生产切换会导致运行中用户输入无法打断工具批次，自然停止后的 follow-up 也不会继续执行。

### 工具观测不完整

原先只发出 tool start/finish，没有 update、phase、开始时间、耗时和 phase 汇总。Runtime 与桌面现有观察面会丢失进度信息。

### checkpoint 时机偏差

新 Engine 原先对所有成功 Assistant 消息触发 `assistant_result`，包括携带 tool calls 的消息；legacy 只在没有工具调用的自然停止处触发。这会让 Runtime 在工具尚未执行前错误进入持久化/压缩检查点。

### 两种消息视图被混合

原先 `AgentCheckpointResult.messages` 直接替换 Engine 状态，无法同时表达：

- 本次模型调用使用经过变换/压缩的瞬态消息视图。
- 后续工具与模型调用使用的持久运行上下文。

这会破坏 Runtime 的无损 envelope 身份或把瞬态 Provider 输入错误写回后续状态。

## 已实现

### 输入端口

- 新增 `takeSteeringMessages` 和 `takeContinuationMessages`。
- 初次模型调用前、每个工具结果后和自然停止后按 legacy 顺序检查 steering。
- continuation 只在自然停止、checkpoint 完成且无 steering 时消费；失败终态不会提前取走 follow-up。
- 输入真正进入上下文时发出 `input_message`，并标记 `steering` 或 `continuation`。

### 工具批次中断与进度

- steering 在一个工具完成后命中时，剩余 tool calls 不执行，但都会生成 `Skipped due to queued user message.` 的错误 ToolResult。
- `RuntimeToolExecutionContext` 增加 `onUpdate()` 与 `reportPhase()`。
- 事件增加 tool update、phase、startedAt、durationMs 和 phases。
- `AgentToolExecutionError` 的结构化 details 在新 Engine 工具结果中保留。

### checkpoint 双视图

- `AgentCheckpointResult.messages` 表示当前 Provider 调用或恢复决策使用的视图。
- `AgentCheckpointResult.contextMessages` 表示后续运行使用的上下文。
- model-call checkpoint 可以同时返回两者；Provider 只看到 `messages`，最终 `AgentRunResult.messages` 保持 `contextMessages` 身份。
- `assistant_result` 只在无工具的自然停止处发出。

## 设计取舍

输入队列仍是拉取端口，不把具体 `SessionInputQueue` 放进 Agent 包。Agent Engine 只理解 `Message` 和输入种类；队列模式、上下文持久化与 origin 身份继续属于 Runtime Adapter。

工具进度由执行上下文主动报告，不让 Engine 推测业务阶段。Engine 只记录时间和转发结构化结果，Runtime 再映射为 session/execution observation。

checkpoint 使用两个显式字段，而不是加入布尔开关决定“是否写回”。字段所有权比隐式模式更容易测试，也能直接表达 Runtime 已有的 transient transform 与 durable compaction。

## 测试

新增或扩展的功能测试覆盖：

- steering 在第一个工具后打断第二个工具，第二个工具不执行但产生配对 ToolResult。
- continuation 在自然停止后进入下一次模型调用。
- 模型失败不会消费 continuation。
- 工具 update、phase、timing 事件完整。
- tool-use turn 不触发 `assistant_result` checkpoint。
- model-call `messages` 与 `contextMessages` 分离且分别进入正确消费者。

canonical differential 从 2 条扩展为 4 条，新增：

- legacy 与新 Engine 的 steering 中断、跳过工具结果和消息顺序一致。
- legacy 与新 Engine 的自然停止 continuation 顺序一致。

验证结果：

- 直接相关：2 个测试文件、23 条测试通过。
- `packages/agent` 全量：16 个测试文件、91 条测试通过。
- `bun run check:quick`：通过。
- 根 `bun run check`：lint、全部类型检查与 guards 通过。

## 预期与实际

预期只补 steering 和 tool progress；实际审计发现 checkpoint 时机与双视图是更高风险的生产阻塞项，因此同批修复。功能范围扩大是由已有 Runtime 契约直接驱动，不是为未来假设增加抽象。

完成后，新 Engine 已能表达队列和工具进度，但仍不能宣称生产等价。剩余差异位于 Runtime Adapter，而不是继续堆入通用 Engine。

## 尚未完成

- 动态 `ModelCallFrame`、Runtime envelope、queued context、legacy stream、salvage 与 Runtime observation 已在 Phase 5B 并行 Adapter 实现。
- generation/agent/tool telemetry 尚未对齐。
- `AgentCoreTurnEngine` 生产组合根切换和 Runtime/Coding Agent 全量回归。

## 下一入口

Phase 5B 已新增独立 Runtime-to-Agent Engine Adapter。下一步补齐 tracer，并让现有生产 Engine 测试矩阵对双实现执行；通过后替换组合根，再运行 Runtime Core、Coding Agent 相关全量和根质量门。
