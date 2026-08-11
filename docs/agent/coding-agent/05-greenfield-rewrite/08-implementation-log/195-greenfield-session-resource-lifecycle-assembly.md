# 第 195 阶段：Greenfield Session Resource Lifecycle Assembly

## 阶段目标

将单个 Greenfield Session 的 Runtime Resources 适配、Hook Session 生命周期、正常清理、清理重试和 Conversation continuation 重绑定从 `greenfield-runtime-composition.ts` 抽取为独立边界。

本阶段只重构架构，不改变 Repository、Prompt、MCP、Tool、Plugin、Todo、Memory、Subagent、Hook、上下文状态、外围控制器、会话续接或资源释放行为。

## 实施前问题

第 194 阶段完成后，主 Composition Root 已不再拥有 Turn Capability 装配，但 `createResources()` 仍约 710 行，并同时负责：

- 创建 Session-local runtime；
- 初始化失败 rollback；
- 构造 `GreenfieldRuntimeResources`；
- Prompt 边界 MCP refresh 和 Todo flush；
- Tool Controller、Session Peripherals、State Source 与 Identity 适配；
- Hook SessionStart、SessionEnd、discard 状态；
- Session 正常 dispose 和分阶段重试；
- continuation 后的 ownership、动态 Session identity 和八组 Session 索引迁移；
- Composition-wide 兜底清理。

初始化 rollback、Session dispose、Composition dispose 三条生命周期交错，continuation 需要逐组执行 `delete/set`。这些逻辑可以工作，但主文件同时拥有资源创建、适配、事务和索引存储，边界不清晰，也容易在新增 Session-local runtime 时漏掉 rebind 或 cleanup。

## 目标边界

```text
Greenfield Runtime Composition Root
  - create Repository and session-local runtimes
  - initialization rollback
  - call Subagent / Turn Capability assemblies
  - call Session Resource Lifecycle assembly
  - Runtime Factory / Backend / composition cleanup
                    |
                    v
Session Resource Lifecycle Assembly
  - Hook Session lifecycle
  - attached resource bindings
  - phased retryable cleanup
  - ownership and identity continuation transaction
  - atomic session-index rebind
                    |
                    +--------------------+
                    |                    |
                    v                    v
Session Runtime Resources Adapter   Session Resource Index
  - prompt/tool/state adapters       - typed value index port
  - peripherals and identity         - typed marker index port
  - runtime-core resource contract   - guarded bind/unbind/rebind
```

## 实施内容

### 1. 新增 Session Resource Lifecycle Assembly

新增 `greenfield-session-resource-lifecycle-assembly.ts`，集中拥有：

- Hook SessionEnd、SessionStart 和 discard 状态；
- Hook disposer 的激活、停用和重新激活；
- Turn Capability attach 后的 Extension、Memory 和 Hook binding；
- Session dispose 的三阶段 `RetryableCleanup`；
- Subagent、Context、Memory、Plugin MCP、Execution、Todo 和 Turn Capability 释放；
- ownership 最后释放及失败重试；
- continuation 时 ownership rebind、Session identity commit、marker 迁移、Turn Capability rebind、全部运行时索引迁移和 Extension Tool rebind。

Assembly 使用显式端口接收 ownership、conversation、runtime tracking 和 Session indexes，没有读取完整 `GreenfieldRuntimeCompositionOptions`。

### 2. 新增 Runtime Resources Adapter

新增 `greenfield-session-runtime-resources.ts`，只负责把 Coding Agent 产品 runtime 投影为 runtime-core 的 `GreenfieldRuntimeResources`：

- Prompt intercept 前刷新当前 Session MCP；
- Prompt prepare 后刷新 Todo 持久化状态；
- 动态 Tool Controller；
- Execution、Background Work 和 Configuration peripherals；
- Session identity；
- Context 使用量与动态 active tool state；
- continuation 和 dispose 回调接线。

模型依赖使用 `GreenfieldSessionModelRuntimePort`，要求 runtime-core 模型控制合同和非空当前模型读取，不绑定具体模型目录或凭据实现。

### 3. 新增类型化 Session Index

新增 `greenfield-session-resource-index.ts`：

- `GreenfieldSessionValueIndex<T>` 定义 `get/set/unbind/rebind/delete/entries/values/clear`；
- `GreenfieldSessionMarkerIndex` 定义动态 Session marker 的迁移；
- Composition Root 使用内存实现，Lifecycle Assembly 只依赖端口；
- `unbind` 和 `rebind` 继续检查当前 Session 是否仍绑定同一实例，保留原有身份保护语义；
- marker 只在源 Session 实际存在时迁移。

MCP Controller、Plugin MCP、Execution、Configuration、Resource Context、Extension Event、Memory Controller 和 Hook Controller 现在通过同一种显式索引合同管理，continuation 不再在主文件手写八组迁移。

### 4. 收窄主 Composition Root

主文件保留：

- 全局工具目录、MCP Synchronizer、Repository 和 Model Adapter；
- 各 Session-local runtime 的创建；
- 初始化失败 rollback；
- Subagent、Turn Capability 和 Resource Lifecycle Assembly 接线；
- Runtime Factory、Backend、宿主 API 与 Composition-wide cleanup。

主文件删除：

- `GreenfieldRuntimeResources` 对象实现；
- Tool Controller、State Source、Session Peripherals 和动态工具状态辅助函数；
- Hook Session 状态机；
- Session 正常清理表；
- continuation 的 ownership、identity 和多索引迁移实现。

主 Composition Root 从本阶段实施前的 1473 行降至 1184 行。新模块按职责拆分为：

- Lifecycle Assembly：358 行；
- Runtime Resources Adapter：238 行；
- Session Resource Index：81 行。

### 5. 保留两阶段初始化顺序

Hook 生命周期必须在 Turn Capability 初始 Prompt preview 前可参与初始化失败 rollback，但 Extension、Memory 和 Hook Session bindings 只能在 preview 成功后对外可见。

因此 Assembly 保留显式两阶段流程：

1. 创建 Lifecycle Assembly 并注册 Hook rollback；
2. Turn Capability 创建并完成初始 Prompt preview；
3. attach Turn Capability，发布 Session bindings 和 Runtime Resources；
4. commit 初始化 rollback scope。

该顺序保留了旧实现中 preview 失败仍执行 SessionEnd、成功前不暴露 Session bindings 的行为。

## continuation 事务语义

Conversation continuation 仍严格保持原顺序：

1. 清理源和目标 Conversation Context Overlay；
2. rebind conversation ownership；
3. ownership 成功后提交新的动态 Session identity；
4. 迁移 MCP refresh marker；
5. rebind Turn Capability 内的 Plugin Session identity；
6. 原子迁移 Memory、MCP、Plugin MCP、Execution、Configuration、Resource Context、Extension Event 和 Hook Controller 索引；
7. 最后 rebind Extension Tool Runtime。

ownership rebind 失败时不会提交新 Session identity，也不会迁移运行时索引。

## 清理与重试语义

Session cleanup 继续使用三个阶段：

- Phase 0：释放 Session-local runtime、结束 Hook Session；
- Phase 1：移除 Session 索引和 MCP refresh marker；
- Phase 2：释放 conversation ownership。

`RetryableCleanup` 仍会移除已经成功的任务，只保留失败任务。ownership 首次释放失败后，再次 dispose 只重试 ownership，不会重复 dispose Turn Capability、Execution、Plugin MCP、Todo、Context 或 Memory。

初始化失败仍由主 Composition Root 的 `InitializationRollbackScope` 逆序清理，不与正常 Session dispose 混用。

## 架构守卫

质量门禁新增主 Composition Root 专用规则，禁止以下职责重新回流：

- `GreenfieldRuntimeResources` 直接构造；
- `GreenfieldBackgroundWorkController` 外围适配；
- Hook Session 状态和 controller 实现；
- `sessionCleanup`；
- `createSessionPeripherals`、`stateSource` 和 `onConversationContinued`；
- active tool state 辅助函数；
- ask-user-question 状态投影。

失败优先验证中，旧主 Composition Root 产生 49 个实际违规；迁移完成后实际仓库守卫通过。

## 功能兼容性核对

- Prompt MCP refresh 时机和首次 refresh observation 不变；
- Todo flush 时机不变；
- active tool override、Coding Tools、MCP deferred tool、Product Tool、Todo、Memory、Subagent、Ask User Question 和 Extension Tool 状态投影不变；
- Execution、Background Work 和 Configuration peripherals 不变；
- Hook SessionEnd 错误仍记录警告且不阻断清理；
- SessionEnd cause 和 SessionStart source 不变；
- continuation ownership、identity 和索引迁移顺序不变；
- dispose phase、失败聚合和重试行为不变；
- Composition-wide cleanup 仍作为未正常释放资源的兜底。

## 类型校验选择

本阶段没有引入 TypeBox 或 Zod。新增内容是进程内 TypeScript 生命周期、资源和索引端口，没有新增 JSON、配置文件、RPC、MCP wire payload 或持久化输入。外部工具输入仍由既有 Schema 校验。

## 测试与验证

- Session Resource Lifecycle Assembly 合同测试：1/1 通过；
- Lifecycle 与 Turn Capability Assembly 合同测试：2/2 通过；
- CLI Runtime Composition、Plugin、Plugin Tool、Hook、Ownership Retry、Continuation 和 Runtime Host 回归：25/25 通过；
- 质量门禁测试：43/43 通过；
- `bun run check:quick` 通过；
- 完整 `bun run check` 通过，包括 Biome、monorepo/CLI/Desktop/Admin 类型检查和全部质量守卫。

Lifecycle 合同测试直接验证：

- ownership rebind 在 Session identity commit 之前执行；
- Turn Capability 和全部 Session 索引迁移到目标 Session；
- 源 Session 索引被清除；
- Hook end/start 会正确移除和恢复全局 disposer；
- ownership 首次释放失败时 dispose 失败；
- 第二次 dispose 只重试 ownership；
- Turn Capability、Execution、Plugin MCP、Todo 和 Context 不会重复释放。

## 阶段结论

本阶段没有重写功能，而是把 Session runtime 创建、runtime-core 资源适配、生命周期事务和索引存储分成清晰边界。主 Composition Root 继续负责全局拓扑和对象创建；Lifecycle Assembly 负责 Session 事务；Runtime Resources Adapter 负责合同投影；Session Index 负责可替换的身份绑定机制。
