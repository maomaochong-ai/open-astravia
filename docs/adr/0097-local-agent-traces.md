# ADR-0097: Agent 本地可观测与执行摘要

- 状态：Accepted
- 日期：2026-08-31
- 关联：ADR-0080、ADR-0082、ADR-0095、ADR-0096

## 背景

独立会话实例与版本化配置需要可查询的执行证据。统一 Observation 已有安全身份信封，原生执行层已有 Agent、generation、tool Span；宿主需要将它们关联并持久化。单纯增加日志不能表达父子执行链，也不能证明一次失败使用了哪个配置版本。

## 决策

使用可观测作为统一能力概念，复用 ADR-0082 的 Observation Hub 与 Adapter。Trace/Span 是执行诊断的数据形态，不是独立产品功能，不设对话内 Trace 面板。安全事件与原生 Span 通过同一 Recorder 汇聚，但保持各自语义，不把父子 Span 改造成平面事件，也不再创建一套事件总线。

保留执行层 Span 所有权。Runtime Core 为原生 Trace 增加 Turn/模型调用 identity，并通过 `runtime.execution.trace` 发布原生 traceId/spanId 与不可变 Agent scope 的关联；产品配置应用事件使用同一 turnId。查询通过记录本身关联实例、定义版本和配置版本，不读取当前会话状态进行猜测。

Session continuation 提交新身份后，会话级 Publisher 使用新 Session ID；Snapshot 获取时同步捕获不可变 Publisher，旧 Turn 不随续接或定义 rollout 改变归属。身份的更新由 Session owner 提供，领域发布者仍不能覆盖父级 scope。

`runtime-telemetry` 提供平台无关的 Trace Record v1、安全投影和 Recorder Adapter。输入/输出、错误正文、任意 metadata/payload 均不进入本地记录；只保存有限 identity、状态、时间、耗时、用量、成本及白名单诊断字段。原生执行层默认不记录错误正文，Tracer 同步和异步失败均不得改变执行结果。

Desktop 拥有单一原子 checkpoint 文件和有界内存索引，默认保留 7 天、5000 条、16 MiB。写入合并且串行化，不阻塞 Agent 执行；关闭 flush。损坏、未来格式和超限文件保持原样，健康状态明确降级，新的记录仍可在内存查询；重启时未结束 Span 标记 interrupted。读取与写入使用相同严格投影。

查询仅作为主进程可观测模块的内部能力保留，不注册专用 IPC 或 preload API：必须指定 sessionId，可按 Turn、Trace、失败过滤和游标分页。结果保留原生父子关系、身份、版本及安全指标。保留策略可能移除父 Span，查询允许返回独立记录，不伪造完整链路。

远端沿既有 `VETTA_TRACING=langfuse` 显式开启，默认不创建 exporter。原生父子关系保留，额外发送 localTraceId/localSpanId 供本地关联；同一安全投影先于任何本地持久化和远端导出。Desktop Runtime 组合根创建并拥有可观测实例及其 Repository/Recorder，不使用供 UI 查询的全局单例；根 Hub 关闭后显式关闭可观测实例，Hub 的非所有权 Adapter 合同保持不变。

## 备选与后果

- 只存平面日志：无法保留 native Span 层级和用量归属。
- Core 直接写文件或绑定 SDK：违反 Runtime 平台边界。
- 保存完整 payload 后脱敏：不可信正文已跨过安全边界，无法为所有出口保证隐私。
- 无界 JSONL：需要另建轮转与索引协议；当前有界原子 checkpoint 更简单，未来可用相同 Record/查询合同替换存储。

本地可观测记录是诊断摘要，不是完整上下文备份或可重放轨迹。保留策略及写入故障可能导致记录不完整；内部查询 health 和结构化日志报告降级状态。此阶段不引入 Agent Team、跨机器通信或新的权限能力。

## 验证

测试覆盖 native execution、错误正文与阶段标签过滤、Tracer 失败隔离、Scope/配置关联、持久化恢复、并发与容量限制、坏文件保护、查询校验、可观测实例隔离与关闭，以及 Desktop 不再暴露诊断入口。不使用真实 Provider、用户状态或远端服务。

## 2026-08-31 修订与兼容

移除独立 Trace UI 与查询 IPC，将宿主采集、查询和生命周期收敛至 `main/agent-observability`。保留底层 `RuntimeTracer`、`RuntimeTraceRecorder`、`RuntimeTraceRecord` v1、`runtime.execution.trace` 关联事件和稳定错误码；它们是既有技术合同，不另建同义 API。文件仍使用 `agent-traces.json`，不改写为新路径、不重置已有记录。配置变更和实例身份继续通过现有 Hub 关联。
