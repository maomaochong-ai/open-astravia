# 第 212 阶段：SDK 产品宿主适配与创建结果闭合

## 阶段目标

本阶段承接第 211 阶段的内部 Greenfield SDK Factory，建立不依赖 CLI 参数解析的 SDK 产品宿主：

1. 把现有 `CreateAgentSessionOptions` 转换成 Greenfield Composition 与 Session options；
2. 保持认证、模型、Settings、Resource、Extension、MCP、Plugin 和 Hook 的产品边界；
3. 把 Legacy `SessionManager` 非破坏性转换成 Greenfield 存储目标；
4. 闭合 `extensionsResult` 与 `modelFallbackMessage` 两个非 Session 返回字段；
5. 让产品资源参与初始化回滚和 `session.close()`；
6. 尚未闭合的 option 继续 fail closed，不切换公开 `createAgentSession`。

## 实施前问题

第 211 阶段的 `createGreenfieldSdkSession` 只接受已经解析的中立参数。它能够创建、恢复和关闭
Runtime Session，但还不能直接消费既有 SDK options：

- `AuthStorage`、`ModelRegistry`、`SettingsManager` 与 `ResourceLoader` 尚未组合；
- MCP Source 在 Composition 之外创建，没有进入 SDK Session 生命周期；
- Extension Runner 必须等 Runtime Session 创建后才能绑定；
- Legacy `SessionManager` 与 Conversation V2 的格式和锁合同不同；
- 原兼容门禁把“架构归属”误当作“接线状态”，导致已经可以由产品适配层转换的字段仍被拒绝；
- Greenfield Core 返回值尚未携带 `extensionsResult` 与 `modelFallbackMessage`。

## 架构决策

### 1. 架构归属与接线状态分离

`SDK_CREATE_OPTION_COMPATIBILITY` 继续回答字段属于 Core、Runtime Capability、Product Adapter 还是
Legacy Concrete；新增 `SDK_CREATE_OPTION_WIRING` 回答 SDK Host Adapter 是否已经无损接线。

因此，`sessionManager` 仍然是 Legacy 具体类型，但可以通过产品层迁移标记为 `wired`；`tools`、
`scopedModels`、Tracing 与自定义 Subagent Factory 仍依赖尚未闭合的完整门面，保持 `not-wired`。
`assessSdkCreateOptionsCompatibility` 依据接线状态准入，不能因为字段位于外围层就永久拒绝，也不能因为
类型可传递就静默忽略。

### 2. SDK Host Adapter 不复用 CLI Bootstrap

新增 `createGreenfieldAgentSession`，直接消费 SDK options。它不解析 CLI args、不执行 CLI migration、
不修改 offline 进程环境，也不依赖 CLI 的输出和退出语义。

宿主保持既有 SDK 的资源优先级：

- 显式 `AuthStorage`、`ModelRegistry`、`SettingsManager`、`ResourceLoader` 优先；
- 未注入 ModelRegistry 时才配置 server 并加载远端模型；
- 未注入 ResourceLoader 时才构造并 reload 默认 Loader；
- 恢复会话模型失败时沿用既有 fallback message；
- Thinking Level 从显式 option、旧会话、Settings 依次解析，并按模型能力关闭不支持的 reasoning。

Greenfield Runtime 必须有初始模型，因此无可用模型时返回结构化 `greenfield_sdk_no_model` 错误；没有
伪造一个无模型 Runtime Session。

### 3. Legacy Session 只读快照迁移

新增独立 SDK Storage Adapter：

- 没有 `SessionManager`：直接创建原生 Conversation V2；
- 空的 in-memory `SessionManager`：映射为正式内存仓储，保留 session ID；
- 持久化 `SessionManager`：读取 Header、Entries 与恢复上下文，写入临时快照，再迁移到确定性的
  Conversation V2 目标并执行 resume；
- 用户的 Legacy 源 JSONL 不原地改写；
- 迁移目标 ID 由源路径和完整快照内容计算，相同快照可复用，内容变化会生成新目标；
- 已有历史的 in-memory `SessionManager` 显式返回
  `greenfield_sdk_in_memory_history_unsupported`，因为把它迁移到文件会破坏“不落盘”语义，而丢弃历史
  又会破坏功能。

Legacy 格式继续由 runtime-storage 已有的严格迁移器和 Coding Agent entry normalizer 校验，没有进入
Runtime Core 或 Composition。

### 4. Factory 提供窄的 Session 初始化端口

`createGreenfieldSdkSession` 新增两类生命周期输入：

- `ownedResources`：Composition 创建前由产品宿主取得的资源，例如 MCP Source；
- `initializeSession`：Runtime Session 创建后绑定的 Session 级资源，例如 Extension Event Host。

初始化失败时按 Extension、Runtime Session、Composition、外部产品资源的逆序回滚；正常关闭时也按
同样的依赖顺序释放。Factory 不认识 MCP、Extension 或具体 Loader，只认识 `id + dispose` 资源合同。

### 5. Extension 与 MCP 使用真实运行时绑定

SDK Host Adapter：

- 为文件 MCP 创建 Managed Runtime Tool Source，并把释放权交给 Factory；
- 把 Extension Tool 定义传入 Composition；
- Runtime Session 创建后构造 `CodingAgentGreenfieldExtensionEventHost`；
- 把 Runner 绑定到对应 session ID，初始化生命周期并发现 Extension 资源；
- 压缩 Extension Runtime 通过延迟 Runner 引用工作；
- Plugin 配置继续由 Session 级 Plugin Runtime 消费，Plugin MCP 由每个 Session 独占创建。

### 6. 本阶段不切换公开 createAgentSession

候选结果已包含：

- Greenfield SDK Core Session；
- `extensionsResult`；
- 可选 `modelFallbackMessage`。

但现有公开 `AgentSession` 仍有大量 Runtime Capability 与产品门面成员，Greenfield SDK Core 不能冒充其
完整类型。本阶段只从 `@vetta/coding-agent/bootstrap` 暴露候选工厂，旧 `createAgentSession` 的签名、
导出与执行路径保持不变。

## 本阶段修改

### coding-agent Composition

- SDK Factory 增加拥有资源与 Session 初始化端口；
- 初始化失败时连同预先取得的产品资源一起回滚；
- SDK Session close 按依赖顺序释放 Extension、Runtime Session、Composition 与 MCP 等外部资源。

### SDK Host

- 新增 SDK 产品宿主适配器；
- 新增 Legacy SessionManager 到 Greenfield Storage Target 的转换器；
- 接入认证、模型、Settings、Resource、Hook、Extension、MCP、Plugin、Memory、Ask 与 Background 配置；
- 闭合创建结果的三个字段；
- 增加结构化宿主与存储转换错误。

### 兼容门禁

- 保留 36 个 create option 的架构归属清单；
- 新增 36 个 option 的穷尽式接线状态清单；
- 已接线的产品与 Legacy 字段可通过；
- 尚依赖完整旧门面的字段继续返回 `greenfield_sdk_option_not_wired`。

## 测试与验证

新增或更新的测试覆盖：

- SDK Host 创建真实 Greenfield 内存会话；
- `session`、`extensionsResult`、`modelFallbackMessage` 返回字段；
- Legacy 文件会话的消息与 Thinking Level 恢复；
- Legacy 源文件迁移前后字节内容不变；
- 会话模型缺失时选择可用模型并返回既有 fallback message；
- 未闭合 option 的结构化拒绝；
- 空内存会话无损映射，以及已有内存历史时拒绝落盘或丢弃；
- Session 级资源先于宿主资源释放；
- 既有内存、文件 create/resume、prompt 与失败回滚路径不回归。

验证结果：

- `bunx vitest --run test/sdk/sdk-compatibility-inventory.test.ts test/sdk/greenfield-sdk-session-integration.test.ts test/sdk/coding-agent-sdk-host-adapter.test.ts test/sdk/coding-agent-sdk-session-storage.test.ts`：15 项通过；
- `bun run check:quick`：通过；
- `bun run check`：通过，包含全仓 Biome、monorepo/CLI/Desktop/Admin 类型检查与架构门禁。

## 阶段结论与后续边界

第 212 阶段已经闭合“现有 SDK options → 产品资源 → Greenfield Factory → 创建结果”的候选链路，且
Legacy 会话迁移和产品资源生命周期没有泄漏进内核。

下一阶段不应直接替换公开工厂。应先建立完整 `AgentSession` 成员的迁移优先级，优先补齐 SDK 常用且可由
现有 Runtime Port 表达的会话能力：模型/Thinking 循环、工具激活、队列、压缩、Retry、Session 元数据与
统计。`tools/customTools` 需要独立动态 Tool Registration Adapter，Tracing 需要进入中立 Turn Engine
配置，不能为通过类型检查而回接 Legacy `AgentSession`。
