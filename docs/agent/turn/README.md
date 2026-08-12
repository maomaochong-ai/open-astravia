# Turn 级运行时状态隔离方案

本目录定义 Vetta Agent 在配置、沙盒、工作模式、Prompt、Tool、Skill、Plugin、MCP 与 Hook
动态变化时的统一一致性边界和实施路线。

核心决策是：

> 会改变执行合同的外部状态在发布后成为不可变 generation；一次 Turn 在 admission 阶段原子绑定一个
> generation 及其资源 lease。普通更新只对之后开始的 Turn 可见；执行状态、物理资源健康和安全撤销仍按
> 各自的实时合同变化。

这里的“结束”指 Kernel Turn 进入 `completed`、`failed` 或 `cancelled` 终态，不是关闭整个
Conversation/Session。Conversation 可以长期存在；同一 Session 的下一个 Turn 应自动采用最新的已发布状态。

## 文档索引

1. [现状与差距](./01-current-state-and-gaps.md)
   - 当前已经具备的 snapshot/lease 能力。
   - 仍在 Model Call、Tool dispatch 和 Hook dispatch 边界读取可变状态的路径。
   - 既有 ADR、规则和测试中需要调整的合同。
2. [目标一致性合同](./02-consistency-contract.md)
   - Session、Turn、Model Call、generation 和紧急撤权的精确定义。
   - 各类状态的生效边界与例外。
   - follow-up、retry、subagent 和后台资源的边界规则。
3. [目标架构与核心合同](./03-target-architecture.md)
   - Published State、Turn Snapshot Materializer、Runtime Snapshot Lease 的关系。
   - 原子发布、Turn admission、资源延迟普通回收流程。
   - 建议的 TypeScript 合同与包职责。
4. [分领域改造方案](./04-domain-migration.md)
   - Settings、Mode、Sandbox、Prompt、Skill、Tool、MCP、Plugin、Hook、Extension 的具体改造点。
   - 现有文件到目标职责的映射。
5. [实施路线与任务拆分](./05-implementation-roadmap.md)
   - 可独立验收的阶段、依赖顺序、兼容策略和删除旧路径的时机。
6. [测试、观测与上线](./06-testing-observability-rollout.md)
   - 竞态测试矩阵、跨宿主合同、诊断字段、灰度开关和最终验收标准。
7. [实施状态与边界结论](./07-implementation-status.md)
   - 已落地的逻辑合同、资源身份隔离和可选的观测增强。
8. [Turn Binding 的能力边界](./08-binding-boundaries.md)
   - 必须绑定、必须实时和必须实时收紧的分类规则。
   - lease、物理故障、重连与 credential rotation 的保证边界。

## 本方案明确不做

- 不把完整外部状态永久复制到 Conversation 或持久化历史中。
- 不把 snapshot 固定到整个 Session 生命周期。
- 不禁止 Turn 内由工具执行产生的合法局部状态变化，例如消息、Todo、MCP Tool Search 激活结果。
- 不把 secret、Token 或进程句柄写入 published revision、诊断 descriptor 或持久化历史；执行面只保存不透明 binding/lease。
- 不用永久双执行路径兼容旧语义。
- 不让普通热重载拥有紧急安全撤权的语义。
- 不快照文件系统、网络、进程健康或远端服务，也不承诺活动 Turn 无损完成。

## 与既有文档的关系

本方案收紧了 [Coding Agent 全面重写方案](../coding-agent/05-greenfield-rewrite/README.md) 中
“Model Call 动态能力”的可见性边界。`ModelCallContributionProvider` 仍可根据本 Turn 已发生的消息、
工具结果和局部激活状态生成不同 Frame，但不得在同一 Turn 内重新读取新的全局配置 generation。

正式编码前应新增一份 ADR，并同步修订：

- [ADR-0046](../../adr/0046-agent-work-mode-orthogonal-axis-global-realtime.md)：保留“全局 UI 实时、Turn
  边界生效”，改由统一 generation 机制实现，不再维护 mode 专属 pending 分支。
- [ADR-0064](../../adr/0064-desktop-plugins-use-coding-agent-hook-adapter.md)：把“每次 dispatch 快照”收紧为
  “Turn 绑定 Hook generation，dispatch 使用该 generation”。
- `packages/coding-agent/AGENTS.md` 与 `packages/coding-agent/README.md`：把动态能力从“下一次模型调用可见”
  改为“下一次 Turn 可见；同一 Turn 内只允许基于 Turn-local state 变化”。
