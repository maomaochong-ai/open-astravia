# 第 196 阶段：Composition Resource Registry 与 Shutdown Transaction

## 阶段目标

第 195 阶段已经把单个 Session 的资源投影、continuation 重绑定和正常清理移出主 Composition Root，但主入口仍直接维护多组 Session 索引、唯一资源集合和 Composition 关闭事务。

本阶段只重构资源所有权和关闭架构，不修改 Tool、Prompt、Skill、MCP、Plugin、Memory、Hook、Subagent、Conversation 或宿主 API 行为。

## 实施前问题

`greenfield-runtime-composition.ts` 同时负责：

- 创建十组 Session value/marker indexes；
- 维护 Context、Memory、Todo、Turn Capability、Hook 和 Ownership 的唯一资源集合；
- 在 Session 初始化与正常释放时手工登记、解除登记；
- 在 Composition 关闭时按索引值去重 Execution 和 Plugin MCP Runtime；
- 构建四阶段 `RetryableCleanup`，包装关闭错误并负责后续重试。

这些状态被 Session 初始化、Session Lifecycle Assembly、宿主查询方法和 Composition `dispose()` 共同修改，资源身份和关闭策略没有独立边界。

## 目标边界

本阶段拆成两个职责明确的模块：

1. `GreenfieldCompositionResourceRegistry`
   - 拥有 Session indexes 和 markers；
   - 登记 Composition 当前持有的唯一资源身份；
   - 为关闭事务生成冻结的清理快照；
   - 解除 Execution/Plugin MCP Runtime 的全部 Session ID 绑定；
   - 不创建、不释放资源，也不决定清理阶段。
2. `GreenfieldCompositionShutdown`
   - 只依赖 `GreenfieldCompositionResourceCleanupRegistry` 端口；
   - 第一次 `dispose()` 时冻结清理集合；
   - 负责关闭阶段、并发执行、错误包装和失败重试；
   - 不提供 Session 查询，也不参与业务装配。

主 Composition Root 继续负责选择具体实现和显式接线。

## 实施过程

### 1. 建立 Composition Resource Registry

新增：

`packages/coding-agent/src/composition/greenfield-composition-resource-registry.ts`

实现内容：

- 集中创建 `GreenfieldSessionResourceIndexes`；
- 为 Context、Memory、Todo、Turn Capability、Hook disposer 和 Ownership 提供角色明确的 track/untrack 方法；
- Execution 与 Plugin MCP Runtime 继续以 Session index 为事实源，清理快照按对象身份去重；
- `unbindExecutionRuntime()` 和 `unbindPluginMcpRuntime()` 一次移除同一实例的全部 Session ID 绑定；
- `clearAuxiliarySessionIndexes()` 只清除非 disposer-bearing bindings。

没有在 Phase 1 清除 Execution 和 Plugin MCP indexes。若它们在 Phase 0 释放失败，这些绑定必须保留到下一次重试；这与原实现一致。

### 2. 建立 Shutdown Transaction

新增：

`packages/coding-agent/src/composition/greenfield-composition-shutdown.ts`

关闭阶段保持原顺序：

- Phase 0：Context、Memory、Execution、Hook Session、Todo、Turn Capability、Ownership、Plugin MCP；
- Phase 1：辅助 Session indexes、MCP refresh markers、Conversation Context Overlay；
- Phase 2：Conversation Repository；
- Phase 3：MCP Synchronizer、Coding Tools。

同一阶段仍通过 `RetryableCleanup` 并发执行。某一阶段出现失败时，后续阶段仍继续；成功任务从 pending 集合删除，后续 `dispose()` 只重试失败任务。

对外错误合同保持不变：关闭失败统一抛出消息为 `Failed to dispose one or more Greenfield runtime resources` 的 `AggregateError`，原始错误保存在 `errors` 中。

### 3. 收窄主 Composition Root

修改：

`packages/coding-agent/src/composition/greenfield-runtime-composition.ts`

主入口现在：

- 创建一个默认内存 Resource Registry；
- 通过 Registry indexes 完成 Tool 激活、MCP refresh 和宿主查询接线；
- Session 初始化和 Lifecycle Assembly 通过 Registry 登记与解除资源；
- 将 Repository、Overlay、MCP 和 Coding Tools 的关闭函数注入 Shutdown Transaction；
- `dispose()` 只委托 `compositionShutdown.dispose()`。

主文件由 1184 行降为 1041 行。移除的是索引实现、资源集合和关闭循环，没有移动或重写业务能力。

### 4. 增加独立合同测试

新增：

`packages/coding-agent/test/runtime-core/greenfield-composition-shutdown.test.ts`

覆盖：

- 同一 Execution/Plugin MCP Runtime 绑定多个 Session ID 时只释放一次；
- 释放成功后移除该实例的全部别名绑定；
- Phase 1 在 Phase 0 后执行，Repository 在 Phase 1 后关闭，MCP/Tools 在 Repository 后关闭；
- Ownership 第一次释放失败时，其余阶段仍完成；
- 第二次关闭只重试失败的 Ownership；
- 已被正常 Session cleanup 解除登记的资源不会在 Composition 关闭时重复释放。

### 5. 增加架构守卫

修改：

- `scripts/quality/check-package-boundaries.mjs`
- `scripts/quality/quality-gates.test.mjs`

守卫禁止主 Composition Root 重新直接拥有：

- `RetryableCleanup` 和 Composition cleanup builder；
- Resource Registry 的具体内存 index 实现；
- Context、Memory、Todo、Turn Capability、Hook 和 Ownership 资源集合。

主入口仍允许导入并组合 Resource Registry 与 Shutdown Transaction。

## 功能兼容性核对

- Session 正常清理仍优先解除资源登记，Composition 关闭不会二次释放；
- continuation 后的 Session ID 绑定仍由第 195 阶段 Lifecycle Assembly 处理；
- Composition 关闭时按资源对象身份去重，不受 Session ID 数量影响；
- 初始化 rollback 仍由 `InitializationRollbackScope` 负责，没有并入正常关闭事务；
- Hook SessionEnd、Memory flush、Plugin MCP、MCP refresh 和 Tool Frame 行为没有修改；
- 宿主公开接口和返回类型没有修改。

## 类型校验选择

本阶段没有引入 TypeBox 或 Zod。新增合同全部是进程内 TypeScript 对象和生命周期端口，不解析 JSON、配置文件、RPC、MCP wire payload 或持久化输入。

## 验证结果

Coding Agent 定向合同：

```text
3 files passed
4 tests passed
```

CLI 真实 Composition 回归：

```text
6 files passed
27 tests passed
```

覆盖 Runtime Composition、Hook、Ownership cleanup retry、Memory、Plugin MCP 和 continuation。

质量守卫：

```text
1 file passed
44 tests passed
```

仓库检查：

```text
bun run check:quick 通过
bun run check 通过
Biome 2070 files 通过
Monorepo、CLI、Desktop、Admin 类型检查通过
全部 quality guards 通过
```

## 阶段结论

Composition 级可变资源状态现在有唯一 Registry 所有者，关闭顺序和重试由独立 Shutdown Transaction 管理。主 Composition Root 只保留具体实现选择、Session 对象创建和端口接线，不再实现资源容器或全局清理算法。

下一阶段不应继续按行数拆文件。应先审计剩余 `createResources()` 是否仍同时包含多个可独立验证的初始化事务；只有存在稳定输入输出合同和可执行 rollback 基线时，才建立 Session Initialization Transaction Assembly。
