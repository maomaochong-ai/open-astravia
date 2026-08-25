# Runtime Core 拥有通用配置 Registry 与快照

## 状态

Accepted

## 背景

Tool、MCP、模型输入处理器和其它 Runtime Capability 都可能需要可发现、可校验、可动态更新的配置。当前配置分散在
Coding Agent Settings、Plugin Settings、构造参数和实现常量中；每增加一个配置维度都要重复修改产品 Store、IPC、UI
和具体工具，并且无法保证同一 Turn 使用同一配置 revision。

ADR-0077 已决定产品无关的 Session、Turn、Runtime Snapshot、生命周期和资源所有权归 `runtime-core`；ADR-0079 已用
Source、revision 与 lease 统一多个 Agent Definition 的动态发布。配置中心具有相同的运行时生命周期，但不应绑定 Tool、
Desktop 或 Coding Agent 产品语义。

## 决策

在 `@vetta/runtime-core/configuration` 建立产品无关的 Runtime Configuration 控制面：

- Configuration Definition 由稳定 id、schemaVersion、可序列化 Descriptor、运行时 Codec、默认值和生效时机构成；
- Definition Registry 按 Source 管理不可变 revision、lease、原子 Source replace、retire、remove 和 last-known-good；
- Runtime Core 不绑定 TypeBox/Zod/Ajv，宿主在不可信边界把具体 schema 编译为 Codec；
- 配置值由宿主提供带 id、revision 和 precedence 的 Layer，Runtime Core 不写死 global/project 或文件路径；
- Layer Registry 按 Source 原子汇总动态 Layer generation，统一 ownership、revision 去重、冲突校验与
  last-known-good；Configuration Center 组合 Definition Registry、Layer Registry 和 Resolver；
- Resolver 按 Layer 深合并并逐层解码，无效层仅对对应 Definition 失效并产生不含值的诊断；
- 解析结果是持有 Definition lease 的不可变 snapshot，后续接入 Turn admission 后只从下一 Turn生效；
- 配置 Definition 与消费者绑定解耦。Tool 只是消费者之一，未提供配置的 Tool 不需要改变；Legacy、Plugin、MCP 和
  黑盒 Tool 可由对应能力包或 Host Adapter 绑定可表达的配置；
- 关键生命周期和解析问题通过 Runtime Observation 输出，核心包不直接依赖 Logger。

`runtime-tools` 继续拥有 Tool identity、注册元数据与 Tool 配置绑定 Adapter；`runtime-mcp` 拥有 MCP 配置适配；
`coding-agent` 只提供产品默认值和组合；平台 Host 拥有持久化、凭证、IPC 和 UI 接线。

## 被拒绝方案

### 在 Coding Agent 建立 Tool 配置中心

会把通用 revision、Layer 和 Turn 一致性归给单一产品，并使非 Coding Agent 和非 Tool Capability 无法复用。

### 在 runtime-tools 建立 Tool 专属 Registry

模型输入 Finalizer、MCP Server 和共享图片处理器不是 Tool，仍会形成并行配置中心。`runtime-tools` 应只提供适配。

### 强制每个 Tool 内嵌配置 Schema

第三方、Legacy 和黑盒 Tool 无法遵守；共享配置也会在多个 Tool 中重复。Definition 与消费者引用分离后，零配置 Tool
可以完全不参与，外部 Adapter 也能独立贡献配置。

### Runtime Core 直接读写统一配置文件

会把路径、平台、锁、凭证和产品作用域下沉到核心。Runtime Core 只定义 Store/Source/Layer Port 与纯运行时语义。

## 后果

- Runtime 获得可被 Tool、MCP、模型输入和其它 Feature 复用的统一配置事实模型；
- Desktop/CLI/服务端可以使用不同 Layer 和持久化 Adapter，而共享解析与 Turn 一致性；
- 未来 Agent 可在获得明确写权限后作为更高 precedence 的 Layer Source 接入，不需要改变消费者协议；
- Definition revision 与配置值 revision 是两条相关但独立的版本轴，Snapshot 必须同时记录；
- 新公共合同需要跨 `runtime-tools`、Coding Agent、Desktop 和 Plugin SDK 分阶段接入并补齐合同测试；
- 旧配置迁移期间只能有一条有效执行路径，避免新旧值同时驱动行为。
