# Phase 5B：Stateless Runtime Adapter

> 历史状态说明：本页记录并行 Adapter 阶段；telemetry 对齐与生产切换已在 [Phase 5C](./13-phase-5c-production-switch.md) 完成。

## 目标与范围

在不改生产默认导出的前提下，新增一个真正调用 `runAgentTurn()` 的 Runtime Turn Engine，证明新 Engine 能承载现有 Runtime 的 Frame、上下文、队列、工具和观察面。

本批新增 `StatelessAgentCoreTurnEngine` 并保留原 `AgentCoreTurnEngine`。完成并行验证不等于生产已切换。

## 已实现

### 模型流边界

- AI Runtime 导出 legacy `AssistantMessageEventStream` 到新 `ModelStreamResponse` 的显式兼容投影，`adaptApiProvider()` 与 Runtime 可复用同一失败归一化。
- 并行 Adapter 仍调用 `streamSimple()`，保留各 Provider 的 reasoning/options 映射；没有让 Runtime 复制 `mapOptionsForApi()`。
- context composition lifecycle 包裹最终 Provider-facing Context，prepared/completed/failed 报告顺序保持不变。
- salvage text tool calls 在 `ModelStreamResponse.result` 边界执行，Engine 后续工具选择看到修正后的 AssistantMessage。

### Frame 与上下文

- 每个 model-call index 绑定一个不可变 `ModelCallFrame`；工具执行使用触发该调用的同一快照。
- 初次 prepared Frame 只消费一次，后续调用重新执行 `resolveModelCallFrame()`。
- `modelCallContextTransformer` 在 model-call checkpoint 前运行。
- checkpoint 的 Provider `messages` 与 Engine `contextMessages` 分别映射；`modelCallMessageFinalizer` 只处理最终模型可见消息。
- `RuntimeMessageEnvelope` 通过 WeakMap 保留 context/opaque/continuation 身份，隐藏上下文不会进入 Provider messages。

### 队列与工具

- steering、follow-up、continuation policy、queued context 持久化和 continuation origin 均映射到新 Engine 输入端口。
- Runtime Tool 转为 Engine Tool；授权仍由 Runtime policy 所有，结构化 `RuntimeToolExecutionError` 转为 `AgentToolExecutionError`。
- update、phase、startedAt、durationMs 和 phase 汇总映射回 session/execution observation。
- Engine 默认用 TypeBox `Value` 校验 TypeBox schema；Runtime/MCP 的普通 JSON Schema 通过显式 `validateInput` 端口交给现有 AJV 边界校验和解码。没有引入 Zod，也没有把普通 JSON Schema 伪装成 TypeBox schema。

### 事件投影

- 新 `AgentEventProjector` 把 Engine execution events 转成现有 `TurnEngineEvent`。
- 文本成功与工具循环的 canonical Runtime event 序列已与 legacy 实现逐项比较。
- `agent.end` 只报告本次 Run 交付的新消息，不重复上报进入 Run 前的上下文。
- 没有 provider `start` event 时，Adapter 会补齐 message start/end 配对，与 legacy terminal-only stream 保持一致。

### 失败和取消

- Provider `error` terminal 在新路径形成结构化 rejection，不再产出 `completed(error)`。
- 失败不会消费 follow-up 队列。
- 取消信号传播到 Provider stream，并以 `AbortError` 拒绝 Turn。
- 修复两处伴生 Promise 风险：事件迭代失败前预先观察 `result` settlement；signal 在 `resolveModelCall()` 返回时竞态触发，也会立即为迟到 response 的 result 安装拒绝处理。

## 设计模式

- **Ports and Adapters**：通用 Engine 不依赖 SessionInputQueue、Runtime Frame、AJV 或产品 envelope；这些都在 Runtime Adapter 映射。
- **Anti-corruption Layer**：legacy stream 的 error-event 语义只在 AI 兼容投影出现，新 Engine 内部仍使用 rejection。
- **Event Projector**：Engine 事件与 Runtime 观察事件分离，避免让 Agent 包依赖产品观察合同。
- **Call-scoped Snapshot**：Frame 以 model-call index 绑定，防止动态能力变更影响已经触发的工具调用。

## 测试

新增 5 条 Runtime Adapter 测试：

- text-only Runtime event projection 与 legacy 一致。
- tool loop、update、phase 和消息顺序与 legacy 一致。
- checkpoint Provider 视图与后续 durable context 分离。
- Provider 失败拒绝且不消费 follow-up。
- 流中取消传播且无未处理拒绝。

同时新增 Agent 自定义 schema validator 测试，并扩展 AI compatibility projection 测试。

最终验证：

- `packages/ai`：34 个测试文件、159 条测试通过。
- `packages/agent`：16 个测试文件、91 条测试通过。
- `packages/runtime-core`：32 个测试文件、157 条测试通过。
- `bun run check:quick`：通过。
- 根 `bun run check`：lint、root/CLI/desktop/admin/docs 类型检查及 guards 全部通过。
- UI 测试按用户明确要求未运行；本批不改 UI。

## 预期与实际

预期是先得到一个可差分的并行 Runtime Adapter。实际已完成，并额外发现并修复跨事件迭代与 result Promise 的取消竞态。这类问题只看成功输出无法发现，失败/取消功能测试是必要的。

最初考虑让 Runtime 直接使用新 AI Adapter Registry，但当前 Registry 原生迁移只完成一个协议族，而 Runtime 持有 `SimpleStreamOptions`。本批保留 `streamSimple()` 作为 options/legacy 兼容入口，再投影成 `ModelStreamResponse`；等 Phase 3 完成所有协议族后再移除该桥，风险更可控。

## 尚未完成

- `AgentCoreTurnEngine` 默认导出仍是 legacy；生产组合根未切换。
- legacy tracer 的 agent/generation/tool observation 尚未接到并行 Adapter；当前不能在开启 tracing 时静默替换。
- 现有 16 条生产 Engine 测试只运行 legacy，尚未全部参数化为双实现矩阵。
- Coding Agent 全量尚未针对生产切换运行，因为本批没有改变默认组合根。

## 下一入口

先把 tracer 建模为 Runtime Adapter 内的观察器并补 span lifecycle 测试；随后让现有生产 Engine 功能矩阵对 legacy/stateless 双实现运行。两者通过后，把 `AgentCoreTurnEngine` 改为新实现或兼容 facade，再运行 Runtime Core、Coding Agent 和根质量门。
