# 分层 Runtime Observation Hub

## 状态

Accepted

## 背景

ADR-0080 建立了 `Token + Publisher + Port` 的统一安全信封，但静态 Composite 只能广播到创建时给定的一组
Port。Agent 模块独立运行时可以自行观测；一旦嵌入 Desktop、CLI、SDK 或更大的多 Agent 宿主，却缺少统一的父子汇聚、
动态 Adapter、过滤、容量保护、失败诊断和生命周期所有权。Coding Agent 初始化回调、Session 业务事件与执行 Trace 也仍有
各自入口，上层无法在不耦合业务类型的前提下统一采集。

“统一”若被理解为把日志、Metric、Trace、Session 事件和 Provider wire capture 合成一个万能事件类型，会同时损失
Span 语义、产品状态语义和安全边界；若每层继续建立自己的 Observer/Callback，则 Adapter、身份与故障处理会持续重复。

## 决策

统一基础设施和信封，不统一领域语义：

1. `RuntimeObservationHub` 是可独立、可嵌套的 `RuntimeObservationPort`。领域模块从 Hub 创建 scoped Publisher，仍由事件
   所有者定义 Token 与安全 payload。
2. Hub 可动态 attach/detach Adapter，并按 domain、level 或 predicate 路由。子 Hub 可把原始 record 原样上送父级
   Port；也可在运行时把上层 Hub 作为普通 Adapter 接入。上层不会重新包装 record，因此 timestamp 和完整 identity 保持不变。
   当上游只有 scoped Publisher 时，使用 Publisher 的 `forward(record)` 与标准 Publisher-to-Port Adapter：record 的
   token、payload、timestamp 不变，只按“父 scope 优先”合并 identity。
3. Hub 隔离 Adapter 的 filter、record 和 flush 失败，提供不含 error message/stack 的安全 Hub issue、交付/过滤/丢弃/
   在途计数，以及有界 pending 保护。观测故障不得改变 Agent 业务流程。
4. 生命周期按所有权关闭：创建根 Hub 的组合根负责 close；子 Hub 不关闭父级；注入父级 Publisher 的 Agent Host 不 flush
   或关闭父级。动态 detach 只停止后续路由，不回收 Adapter 自己拥有的外部资源。
5. 既有 Session 业务事件通过 `runtime.session.event` 做内容安全投影后才进入 Hub。投影只保留结构、计数、耗时、usage、
   模型身份和稳定失败字段，不携带消息/Thinking、Tool 参数与结果、命令/路径、扩展 payload 或错误正文。
6. `runtime-telemetry` 提供日志与 AgentTracer Adapter。Tracer Adapter 把统一 record 写成平面 event；原生父子 Span、
   generation/tool 生命周期仍由执行层 tracer 负责，`context.traceId` 作为 metadata 关联，不能伪装成 tracer 的原生父子关系。
7. 产品专用观测属于产品包。例如 Coding Agent 定义 `coding-agent.session.initialization`；Runtime Core 不认识初始化阶段、
   Profile、Persona 或 Mode。产品不得再为同一事件维护并行的专用 callback。
8. 每个 Coding Agent Runtime Composition 创建并拥有一个产品子 Hub。应用可作为 parent 统一汇聚，本地 Adapter 可动态
   attach；Composition 在其它产品资源释放后关闭子 Hub，但不关闭父级。Coding Agent 的子代理 Composition 继续以当前
   产品 Hub 为父级，避免全部模块绕过产品边界直接连接应用根。

分层结构如下：

```text
领域 Token/安全 payload
        |
scoped Publisher（Agent / Session / Turn / Tool identity）
        |
模块 Hub（可独立观测） ---- 本地 Adapter
        |
应用 Hub（多 Agent 统一汇聚）
        |
日志 / Metrics / Trace event / JSONL / UI Adapter
```

## 备选方案

### 只保留一个进程级全局 Hub

否决。模块无法脱离应用单独测试和部署，局部 Adapter 也必须认识上层组合根；并且全局单例会模糊所有权与测试隔离。

### 把 AgentTracer 扩成万能观测 API

否决。Tracer 的核心是父子操作与生命周期，Registry revision、MCP inventory、配置同步和产品状态并不天然是 Span。

### 把 SessionEvent 原样转发给 Hub

否决。SessionEvent 是业务/UI 数据面，包含消息、参数、结果、路径和错误正文；原样转发会突破 ADR-0080 的默认隐私边界。

### 保留产品 callback，再由宿主转成 Observation

否决。同一事实存在两条发布路径，失败隔离、身份和 Adapter 选择重复，且模块独立接入与上层汇聚的行为不一致。

## 后果

- Agent、Coding Agent 或任意产品模块可以只创建本地 Hub 独立观测，也可以嵌入上层 Hub；未来的路由变化不改变已运行
  Agent 的 Prompt、Tool、MCP、模型或 Snapshot generation，只影响后续观测交付。
- 上层可以统一注册日志、Trace、Metrics、JSONL 或 UI Adapter，并保留模块自己的局部 Adapter 和 Token 语义。
- 新事件仍必须由领域所有者设计安全 payload；Hub 和 Adapter 不承担“收到敏感正文后再脱敏”的责任。
- Hub snapshot 是交付健康度，不是业务指标；需要持久化、重试或至少一次语义的 Adapter 自行拥有队列与 flush。
- Trace/Session 桥接是显式且有损的安全投影。需要完整业务状态或原生 Span 的消费者继续使用各自原生合同。
- 普通工程日志、安全审计和原生 Trace Span 不因产品子 Hub 而迁入 Observation。日志 Adapter 只把已经通过安全合同的
  Observation 投影为结构化日志；Hub 自身容量/关闭问题仍可使用不经过 Hub 的紧急诊断回调。
