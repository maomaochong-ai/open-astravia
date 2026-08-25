# Team: Runtime

> 本包属于 **Runtime Team**，同组包：`runtime-core`、`runtime-mcp`、`runtime-storage`、`runtime-tools`、`cli-host`

## 职责范围

日志和遥测接口及具体传输适配边界：提供 `RuntimeLogger`、`ConsoleRuntimeLogger`、AgentTracer 兼容类型、
Langfuse exporter，以及把 `runtime-core` 统一 Observation 投影到结构化日志/平面 Trace event 的 Port Adapter。

## 注意事项

- `runtime-core` 只拥有安全信封、Hub 与领域投影；本包拥有日志/Trace 的具体 Adapter，不得让 Telemetry SDK 反向进入 Core。
- Observation Tracer Adapter 只产生平面 event；执行层 Agent/generation/tool 的父子 Span 继续由 `agent-core` tracer 拥有。
- Adapter 不拥有注入 Logger/Tracer 的 shutdown；只在 Port `flush()` 中委托 tracer flush。
