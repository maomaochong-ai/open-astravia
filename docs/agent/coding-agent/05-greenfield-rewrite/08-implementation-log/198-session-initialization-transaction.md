# 第 198 阶段：Session Initialization Transaction

## 阶段目标

第 197 阶段完成 MCP Session Coordinator 后，主 `greenfield-runtime-composition.ts` 中仍有一段约 450 行的 `createResources()`。它直接创建 Session 对象图、登记 14 个初始化 rollback 节点，并负责最终 commit。

本阶段把这条完整初始化事务移出 Composition Root，同时分离公共 Composition 合同。只重构初始化架构，不修改 Tool、Prompt、Skill、MCP、Plugin、Memory、Hook、Subagent、Conversation 或宿主行为。

## 实施前边界确认

现有 `createResources()` 已具备稳定事务边界：

- 输入是 `GreenfieldRuntimeSessionOptions`、`GreenfieldRuntimeResourceContext` 和 Composition 级端口；
- 输出是 `GreenfieldRuntimeResources`；
- `previewInitialSystemPrompt()` 完成后才绑定最终 Session resources；
- `rollback.commit()` 是明确提交点；
- 失败时由 `InitializationRollbackScope` 严格逆序释放已获取资源。

原 rollback 登记顺序为：

1. Conversation ownership；
2. Resource context binding；
3. Conversation context overlay；
4. Configuration state binding；
5. Plugin MCP runtime；
6. MCP controller binding；
7. Execution runtime；
8. Memory runtime；
9. Todo runtime；
10. Context runtime；
11. Subagent runtime；
12. Hook session；
13. Capability composition；
14. Session bindings。

本阶段保留全部节点、登记时机和逆序执行语义。

## 实施过程

### 1. 分离公共 Composition 合同

新增：

`packages/coding-agent/src/composition/greenfield-runtime-composition-contract.ts`

该文件集中定义：

- `GreenfieldRuntimeSessionOptions`；
- `GreenfieldRuntimeCompositionOptions`；
- `GreenfieldRuntimeComposition`；
- Session Hook lifecycle；
- Legacy CLI options 类型别名。

原 `greenfield-runtime-composition.ts` 继续 re-export 全部公共类型，调用方导入路径和类型名称不变。独立合同避免 Initialization Transaction 反向依赖 Root 实现文件。

### 2. 建立 Session Initialization Transaction

新增：

`packages/coding-agent/src/composition/greenfield-session-initialization-transaction.ts`

Transaction 统一负责：

- 获取和释放 Conversation ownership；
- 建立 ResourceContext、Configuration、Plugin MCP 和 MCP Controller 绑定；
- 创建 Execution、Memory、Todo、Model、Hook 和 Context runtime；
- 创建 Subagent、Resource Lifecycle 和 Turn Capability Assembly；
- 预览初始系统提示词；
- 附加最终 Session bindings；
- commit 前的初始化失败回滚。

它通过结构化端口接收：

- Conversation repository resources；
- Composition resource registry；
- MCP Coordinator；
- Coding Tools；
- Ownership acquire/rebind/release；
- Child Composition factory；
- Tool activation resolver。

Ownership binding 使用泛型保持不透明，Transaction 不依赖 `ConversationOwnershipBinding` 的具体实现，也不自行拼接持久化路径。

### 3. 收窄 Composition Root

修改：

`packages/coding-agent/src/composition/greenfield-runtime-composition.ts`

Root 现在负责：

- 选择并创建 Composition 级具体实现；
- 把 Repository、Registry、MCP、Coding Tools 和 Ownership 适配为 Transaction 端口；
- 提供递归 Child Composition factory；
- 将 `runtimeFactory.createResources` 委托给 Session Initialization Transaction；
- 暴露宿主 facade 和 Composition shutdown。

主文件由第 197 阶段的 953 行降为 342 行。公共合同为 176 行，初始化事务为 551 行；代码按“公开合同、Composition 接线、单 Session 初始化事务”分离，而不是移动到另一个无边界的总入口。

### 4. 增加初始化事务回归测试

新增：

`packages/coding-agent/test/runtime-core/greenfield-session-initialization-transaction.test.ts`

测试在初始 Prompt 预览阶段主动失败，同时持有真实 Memory/Todo runtime、Plugin MCP runtime 和 Conversation ownership，验证：

- 可观察回滚顺序保持 `Todo -> Memory -> Plugin MCP -> Ownership`；
- 每项失败初始化资源被释放；
- Ownership 释放后没有残留占用；
- 相同 Session ID 可立即重新初始化；
- 成功 Session 仍能通过正常 lifecycle 释放。

完整 Capability、Hook、Context、Execution 与绑定清理继续由既有 Lifecycle、Ownership 和真实 CLI 测试覆盖。

### 5. 增加架构守卫

修改：

- `scripts/quality/check-package-boundaries.mjs`
- `scripts/quality/quality-gates.test.mjs`

守卫禁止主 Composition Root 重新直接拥有：

- `InitializationRollbackScope`；
- 14 个初始化 rollback task ID；
- Session Execution、Configuration、Memory、Todo、Context 和 Hook runtime 创建；
- Subagent、Resource Lifecycle 与 Turn Capability 子 Assembly 创建；
- Session plugin/fork context 初始化 helper。

Root 只允许组合 `createGreenfieldSessionInitializationTransaction`。

## 功能兼容性核对

- 14 个初始化 rollback 节点及逆序关系未改变；
- 初始化 rollback 仍是一次性事务，没有与正常 `RetryableCleanup` 合并；
- 正常 Session cleanup 的阶段、并发和失败重试未改变；
- Plugin MCP 仍先 reconfigure 后绑定到 Session index；
- MCP Controller、Execution 和其他 Session indexes 的绑定时机未改变；
- 初始 Prompt 仍在最终 Session bindings 之前预览；
- Subagent Child Composition 仍移除共享 MCP source、Plugin MCP factory 和 Extension Tools，并继承父级 MCP view；
- 公共 Composition API、类型名称和导入路径未改变；
- 没有新增配置项，也没有修改能力选择或 Tool 描述。

## 类型校验选择

本阶段没有引入 TypeBox 或 Zod。新增合同和 Transaction ports 都是进程内 TypeScript 对象，不解析 JSON、RPC、MCP wire payload、配置文件或持久化输入。

## 验证结果

Coding Agent 初始化与相邻 Assembly 合同：

```text
5 files passed
8 tests passed
```

CLI Composition、Plugin MCP 与 Ownership 回归：

```text
3 files passed
19 tests passed
```

真实 Vetta RPC CLI 初始化失败回归：

```text
1 file passed
2 tests passed
```

质量守卫：

```text
1 file passed
46 tests passed
```

仓库检查：

```text
bun run check:quick 通过
bun run check 通过
Biome 2075 files 通过
Monorepo、CLI、Desktop、Admin 类型检查通过
全部 quality guards 通过
```

## 阶段结论

Session 初始化现在是独立事务边界：Composition Root 选择实现并提供端口，Transaction 创建单 Session 对象图并在 commit 前持有 rollback 责任，Resource Lifecycle Assembly 在 commit 后接管正常释放责任。

下一阶段不应继续按 Root 行数拆分。当前 Root 已降至 342 行，应先审计剩余 Composition bootstrap、宿主 facade 和 Tool activation policy 是否存在真实的独立所有权或替换需求；没有稳定合同与测试收益的 helper 不再拆分。
