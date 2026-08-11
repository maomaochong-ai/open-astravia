# Phase 5：Runtime 接入状态

## 已实现

- Turn Pipeline 使用显式 checkpoint callback 完成持久化、压缩和一次恢复决策。
- `ModelCallFrame` 是每次调用的 instruction/tool 快照，当前调用中的工具执行继续使用触发它的 Frame。
- Frame 支持隐私安全的 context composition provenance。
- Runtime Host 的 state、usage observation 与 Session contract 已能传递上下文组成报告。
- Coding Agent 在产品组合边界为 prompt block 和 tool schema 标注 core、skill、plugin、MCP、runtime 来源。
- 模型调用生命周期绑定到最终 Provider-facing Context，避免按初始 prompt 估算。
- 新 Engine 已具备 steering、continuation、工具 update/phase/timing 和 checkpoint 双视图端口，并与 legacy 结果做差分验证。
- 新增并行 `StatelessAgentCoreTurnEngine`，已接入动态 Frame、message envelope、checkpoint/transform/finalizer、队列、工具、salvage、context composition lifecycle 和 Runtime observation。
- AI Runtime 提供显式 legacy Assistant stream 到 `ModelStreamResponse` 的兼容投影；Runtime 继续经 `streamSimple()` 保留 Provider-specific options 映射。
- `AgentCoreTurnEngine` 公共类名保持不变，内部已切换为 `StatelessAgentCoreTurnEngine` facade；生产组合根不再调用 `agentLoopContinue()`。
- agent/generation/tool telemetry 已由 Runtime Adapter 订阅 Engine 事件实现，包含内容采集开关、agent-only 粒度、usage/cost 聚合、幂等终止和 flush。
- checkpoint 前通过 Runtime 事件交付屏障等待既有消息/工具事件完成投影，保持“先交付消息，再执行持久化 checkpoint”的事务顺序。

## 尚未完成

- `packages/agent` 的高层兼容 Agent facade 仍使用 legacy loop；Runtime 生产切换不等于 legacy loop 已可删除。
- `AgentCoreTurnEngineOptions` 作为稳定组合契约仍被 Coding Agent composition 引用，具体实现已与契约拆文件。
- Coding Agent 的 compaction、memory、session、RPC、Extension public contract 仍有较多 `AgentMessage`、`ThinkingLevel`、`ToolPhase` 类型依赖。
- `ToolPhase`、产品消息 envelope 与 reasoning 类型的最终所有权尚未迁移。
- Runtime 仍经 `streamSimple()` 和 AI compatibility projection 接入尚未原生迁移的 Provider；需等待 Phase 3 完成后移除。

## 生产切换方式

生产切换没有修改 Coding Agent 和 Runtime Host 的构造调用。公共 `AgentCoreTurnEngine` 变为薄 facade，稳定 options 契约拆到独立文件，内部 stateless 实现不新增公共导出。原 16 条生产 Engine 测试直接运行新实现；迁移期间的 facade/内部实现 canonical 守卫继续保留。

Provider `error` 与取消不再伪装为 `completed(error|aborted)`：Engine 以结构化失败或 `AbortError` 拒绝，Turn Pipeline 分别归类为 failed/cancelled。队列测试确保失败不会提前消费 follow-up。

## 验证

- `packages/agent`：16 个测试文件、93 条测试通过。
- `packages/runtime-core`：33 个测试文件、161 条测试通过；包含 5 条 Adapter 测试、4 条 telemetry 测试和 16 条生产 Engine 矩阵。
- `packages/runtime-tools`：26 个测试文件、231 条测试通过。
- `packages/coding-agent`：154 个测试文件、991 条测试通过；17 条环境型测试按既有条件跳过。
- `packages/ai`：34 个测试文件、159 条测试通过。
- `bun run check:quick`：通过。
- 根 `bun run check`：lint、root/CLI/desktop/admin/docs 类型检查及全部 guards 通过。
- Runtime 端到端测试已覆盖 prepared/completed report、Provider actual usage 和 Host state/event 传播。

Phase 5A 的详细审计和改动见 [11-phase-5a-engine-runtime-parity.md](./11-phase-5a-engine-runtime-parity.md)。
Phase 5B 的并行 Adapter、失败语义和验证见 [12-phase-5b-stateless-runtime-adapter.md](./12-phase-5b-stateless-runtime-adapter.md)。
Phase 5C 的 telemetry、生产 facade、兼容矩阵和上游验证见 [13-phase-5c-production-switch.md](./13-phase-5c-production-switch.md)。

## 完成判据

Runtime 生产 Engine 切换判据已经满足：生产 `AgentCoreTurnEngine` 不再调用 `agentLoopContinue()`，Runtime canonical outcome、telemetry 和上游应用回归通过。Phase 5 剩余的是跨包类型归位与 Provider compatibility bridge 清理，不能与生产 Engine 切换混为一项。
