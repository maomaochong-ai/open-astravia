# Runtime 统一可观测端口

## 状态

Accepted

## 背景

多主 Agent 基座需要同时观测 Definition revision、Instance、Session、Prompt 组装、Tool 执行和 MCP
同步。现有执行层 Trace、Session 事件与模块日志分别服务模型调用、产品状态和局部诊断，没有共享的
Agent/Session/Turn identity，也无法让 OTLP、Langfuse、JSONL、内存记录器或 Desktop 面板复用同一边界。

若 Runtime 直接依赖某个 Telemetry SDK，平台无关包会绑定传输、进程与部署策略；若复用 Session 业务事件，
观测实现失败可能改变状态机，并容易把 Prompt、参数、结果或凭证带出信任边界。

## 决策

在 `@vetta/runtime-core/observation` 建立产品和平台无关的类型化观测端口：

- 事件所有者通过 `RuntimeObservationToken<Payload>` 定义自己的稳定事件与强类型安全摘要；Core 不维护
  MCP、Coding Tool 或产品事件的集中枚举。
- `RuntimeObservationPublisher` 绑定可选的 agent/revision/instance/session/turn/modelCall/toolCall/trace
  identity。子 scope 可以补充 identity，但不能覆盖已绑定的上层 identity。
- `RuntimeObservationPort` 是具体日志、Trace、Metrics、JSONL 和 UI Adapter 的唯一输出边界。同步抛错、
  异步拒绝与 flush 失败全部隔离，不允许改变 Agent 主流程。
- Runtime 默认只发布结构指标、身份、阶段、耗时、计数与安全错误投影。错误只包含 category、name 和 code；
  Prompt 正文、用户消息、Tool 参数值、Tool 结果正文、MCP fingerprint/凭证和错误 message 不进入事件。
- Agent 工厂上下文接收已经绑定 identity 的 Publisher，使动态自定义 Agent 能把自有 MCP、Tool Catalog、
  中间件或扩展接到同一作用域，而不接触具体观测实现。
- Publisher 同时进入每个 Session 的 `RuntimeCapabilityDefinition` 与不可变 Snapshot generation；Prompt 和最终
  Tool 装饰因此与当前 revision/Session/Turn 同代，rollout 不会混用身份。
- 既有执行层 `AgentTracer` 与 Session 业务事件保持原职责。具体 Adapter 可以桥接它们，但 Runtime Core
  不强制一种 Span、Metric 或日志模型。

## 备选方案

### 扩展 AgentTracer 覆盖全部 Runtime 控制面

否决。它位于模型执行层，不应认识 Definition Source、Instance、MCP Inventory 或产品扩展。

### 把观测实现作为 Session Extension

否决。Extension 是 Session 资源组合，无法覆盖 Registry、Source 和 Instance 创建前的控制面事件；其失败
与权限合同也不应承担基础诊断输出。

### 发布完整 Prompt、参数和结果，由 Adapter 自行脱敏

否决。不可信内容一旦越过领域边界便无法保证所有 Adapter 正确脱敏。安全摘要必须由事件所有者在首次发布时
构造。

## 后果

- 任意宿主只需实现一个 Port 即可统一采集 Agent、Prompt、Tool 与 MCP 关键事件。
- 自定义 Agent 可通过代码或配置动态组装自己的事件源和 Adapter，Runtime 不依赖具体业务/Profile。
- 新增观测事件必须设计显式安全 payload 并以无内容泄漏测试保护；需要采集正文的产品必须在更上层建立独立、
  明示授权的合同，不能扩大本端口的默认数据面。
- Fire-and-forget Adapter 必须在自身 `flush()` 中等待已提交记录；Host close 会调用 Publisher flush，但不会传播
  Adapter 失败。

分层汇聚、动态路由、生命周期所有权以及 Trace/Session 安全桥接由
[ADR-0082：分层 Runtime Observation Hub](./0082-hierarchical-runtime-observation-hub.md) 补充；本 ADR 的 Token、
Publisher、Port 与安全 payload 决策保持不变。
