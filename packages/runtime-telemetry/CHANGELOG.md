# Changelog

## [Unreleased]

### Changed

- `RuntimeTracer`、`RuntimeObservation` 及相关类型改为 `@vetta/agent-core` 观测 Port 的兼容别名；
  Langfuse 实现与既有 import 路径保持不变，同时移除 Agent 内核对 Runtime 包的反向依赖。

### Added

- 新增安全 Trace Record v1 与可注入 sink 的 RuntimeTraceRecorder，保留 native Span 层级、有限身份/状态/用量和本地关联 ID；支持可选远端导出、打开 Span 容量上限、关闭清理与 Adapter 失败隔离。
- 将本包合同测试纳入 workspace 测试入口。
- 新增结构化日志与 AgentTracer 的 `RuntimeObservationPort` Adapter；日志 Adapter 保留统一 identity，Tracer
  Adapter 将每条 record 投影为平面 event 并委托 flush，不取得 tracer shutdown 所有权。
- 新增平台无关 `RuntimeTracer` / `RuntimeObservation` tracing 契约，并提供基于 Langfuse JS/TS SDK v5 + OpenTelemetry 的 Langfuse exporter。
- `RuntimeObservationUpdate` 支持 `userId`、`sessionId`、`traceName`、`tags`、`version` 等 trace 归属字段；Langfuse exporter 会通过 attribute propagation 写入，支持 Langfuse Sessions 与 trace 维度聚合。
