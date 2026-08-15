# Changelog

## [Unreleased]

### Changed

- `RuntimeTracer`、`RuntimeObservation` 及相关类型改为 `@vetta/agent-core` 观测 Port 的兼容别名；
  Langfuse 实现与既有 import 路径保持不变，同时移除 Agent 内核对 Runtime 包的反向依赖。

### Added

- 新增平台无关 `RuntimeTracer` / `RuntimeObservation` tracing 契约，并提供基于 Langfuse JS/TS SDK v5 + OpenTelemetry 的 Langfuse exporter。
- `RuntimeObservationUpdate` 支持 `userId`、`sessionId`、`traceName`、`tags`、`version` 等 trace 归属字段；Langfuse exporter 会通过 attribute propagation 写入，支持 Langfuse Sessions 与 trace 维度聚合。
