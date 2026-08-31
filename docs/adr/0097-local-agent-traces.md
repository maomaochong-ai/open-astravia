# ADR-0097: 本地 Agent 执行 Trace

- 状态：Accepted
- 日期：2026-08-31
- 关联：ADR-0080、ADR-0082、ADR-0095、ADR-0096

## 背景

独立会话实例与版本化配置需要可查询的执行证据。统一 Observation 已有安全身份信封，原生执行层已有 Agent、generation、tool Span；Desktop 尚未将它们关联、持久化并展示。单纯增加日志不能表达父子执行链，也不能证明一次失败使用了哪个配置版本。

## 决策

保留执行层 Span 所有权。Runtime Core 为原生 Trace 增加 Turn/模型调用 identity，并通过 `runtime.execution.trace` 发布原生 traceId/spanId 与不可变 Agent scope 的关联；产品配置应用事件使用同一 turnId。查询通过记录本身关联实例、定义版本和配置版本，不读取当前会话状态进行猜测。

Session continuation 提交新身份后，会话级 Publisher 使用新 Session ID；Snapshot 获取时同步捕获不可变 Publisher，旧 Turn 不随续接或定义 rollout 改变归属。身份的更新由 Session owner 提供，领域发布者仍不能覆盖父级 scope。

`runtime-telemetry` 提供平台无关的 Trace Record v1、安全投影和 Recorder Adapter。输入/输出、错误正文、任意 metadata/payload 均不进入本地记录；只保存有限 identity、状态、时间、耗时、用量、成本及白名单诊断字段。原生执行层默认不记录错误正文，Tracer 同步和异步失败均不得改变执行结果。

Desktop 拥有单一原子 checkpoint 文件和有界内存索引，默认保留 7 天、5000 条、16 MiB。写入合并且串行化，不阻塞 Agent 执行；关闭 flush。损坏、未来格式和超限文件保持原样，健康状态明确降级，新的记录仍可在内存查询；重启时未结束 Span 标记 interrupted。读取与写入使用相同严格投影。

查询是只读 IPC：必须指定 sessionId，可按 Turn、Trace、失败过滤和游标分页。会话诊断界面展示原生父子关系、身份、版本及安全指标。保留策略可能移除父 Span，界面允许独立展示剩余记录，不伪造完整链路。

远端沿既有 `VETTA_TRACING=langfuse` 显式开启，默认不创建 exporter。原生父子关系保留，额外发送 localTraceId/localSpanId 供本地关联；同一安全投影先于任何本地持久化和远端导出。Desktop 组合根拥有 Recorder，根 Port 关闭后显式关闭 Recorder，Hub 的非所有权 Adapter 合同保持不变。

## 备选与后果

- 只存平面日志：无法保留 native Span 层级和用量归属。
- Core 直接写文件或绑定 SDK：违反 Runtime 平台边界。
- 保存完整 payload 后脱敏：不可信正文已跨过安全边界，无法为所有出口保证隐私。
- 无界 JSONL：需要另建轮转与索引协议；当前有界原子 checkpoint 更简单，未来可用相同 Record/查询合同替换存储。

Trace 是诊断摘要，不是完整上下文备份或可重放轨迹。保留策略及写入故障可能导致记录不完整；UI 显示降级状态。此阶段不引入 Agent Team、跨机器通信或新的权限能力。

## 验证

测试覆盖 native execution、错误正文与阶段标签过滤、Tracer 失败隔离、Scope/配置关联、持久化恢复、并发与容量限制、坏文件保护、查询校验和 Desktop 筛选/展开/重试交互。不使用真实 Provider、用户状态或远端服务。
