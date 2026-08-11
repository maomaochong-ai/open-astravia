# 第 162 轮：Session 可变能力命令边界

## 目标

延续第 161 轮的 Session 写操作准入，本轮收口 Legacy `AgentSession` 仍向宿主暴露原始可变对象的问题，并隔离观察者异常。目标是调整所有权和调用边界，不修改 Todo、后台任务、Subagent、历史编辑或事件协议的业务功能。

本轮处理四类问题：

1. `todoStore`、`backgroundTasks`、`subagents` 直接返回状态所有者，宿主可绕过 Session identity transition 的准入规则。
2. RuntimeHost 历史适配器直接调用 `SessionManager.branchWithSummary` 和 `replaceLastUserMessage`，没有经过 `AgentSession` 的写门禁。
3. 已排队切换后的异步 Subagent 命令可能继续绑定源 Coordinator，而不是在目标 identity 上开始。
4. Session 或 Runtime 事件的一个监听器抛错，会阻止后续监听器收到同一事件，并可能反向破坏业务操作。

## 架构结论

### 1. 状态所有者与命令能力分离

`TodoStore`、`BackgroundTaskManager` 和 `SubagentCoordinator` 继续作为 `AgentSession` 内部的状态所有者，由 Runtime、Tool 和生命周期控制器直接使用。宿主侧公开属性改为三个窄控制器：

- `SessionTodoController`
- `SessionBackgroundTaskController`
- `SessionSubagentController`

控制器只转发既有命令和只读查询，不暴露 Manager 的内部集合、持久化回调或生命周期字段。这样不需要复制状态，也不需要创建运行时整份快照。

为了保留已有调用方式，`session.todoStore.createMany()`、`session.backgroundTasks.kill()` 和 `session.subagents.spawn()` 等方法名与返回值不变；变化仅在于返回对象不再是原始实现类。

### 2. 所有写命令统一进入 Session 准入

新增最小 `SessionOperationGate` 合同，由已有 `SessionNavigator` 结构化实现：

- 同步写操作使用 `runImmediateSessionOperation`。切换已排队或执行中时立即抛出 `Session identity transition is pending`，不会猜测源或目标。
- 异步 Subagent `spawn`、`sendMessage`、`followUp` 使用 `startSessionOperation`，等待已排队切换提交后再执行。
- `interrupt`、`kill`、`wait` 等停止或收尾动作不被阻断，保证切换和关闭仍能静默旧资源。

新增准入覆盖包括：

- Todo `createMany`、`update`、`clear`、`lock`
- Background Task `spawn`、`clearFinished`
- Subagent `spawn`、`spawnMany`、`sendMessage`、`followUp`、`clearFinished`
- 历史 `appendBranchSummary`、`replaceLastUserMessage`

Legacy RuntimeHost 历史控制器现在调用 `AgentSession` 命令，不再直接组合 `SessionManager` 与 `Agent.replaceMessages`。

### 3. 同步资源句柄与异步命令采用不同绑定策略

后台任务控制器绑定创建时的 Manager。这样切换前取得的控制器仍可查询、等待或终止源 identity 中已经存在的进程，但不能在切换窗口创建新任务；切换后 `AgentSession.backgroundTasks` 返回新控制器。

Subagent 的异步命令需要不同语义：调用发生在切换已排队之后时，应等待并使用提交后的 Coordinator。因此 Subagent 控制器按执行时解析当前 Coordinator，而不是永久捕获源实例。控制器对象仍随 identity 轮换，保持既有 UI/宿主对资源更换的可观察性。

Todo Store 在 identity replacement 中按目标 Session 快照原位恢复，因此 Todo 控制器稳定持有同一内部 Store；公开查询和订阅返回逐项复制的只读快照，外部修改返回对象不会静默篡改 Store。

### 4. 观察者是隔离边界，不是业务调用栈

以下事件扇出现在逐监听器捕获异常并继续：

- `AgentSession` 事件订阅
- `LegacyRuntimeSessionEventStream` 映射后的 Runtime Session 事件
- `BackgroundTaskManager` 内部事件订阅

监听器失败会记录警告，但不阻止后续监听器，也不让 Todo 持久化、后台任务状态变化或 Session identity 提交失败。事件 payload、顺序和映射类型均未修改。

## 类型校验选择

本轮没有引入 TypeBox 或 Zod。

新增的是进程内 TypeScript 命令合同和对象引用，不涉及 JSON、RPC、配置、磁盘或插件未知输入。正确性约束是所有权、准入时序和观察者隔离，运行时 Schema 校验不能解决这些问题。Todo 工具依赖从具体 `TodoStore` 收窄为结构化 `TodoToolStore` 接口，使内部 Store 与公开 Controller 复用同一业务实现，而不复制 Tool 逻辑。

## 明确未修改

- 未修改任何 Tool 名称、参数 Schema、描述、结果文案、动态注册或启停规则。
- 未修改 Todo 锁定、顺序执行、持久化与恢复规则。
- 未修改后台 Bash 启动、输出、通知、终止或清理语义。
- 未修改 Subagent 类型、并发、排队、恢复、通知或 transcript 行为。
- 未修改 Session JSONL、Runtime SessionEvent、Extension、Prompt、Skill、MCP、Knowledge 或 Memory 行为。
- 未引入全局队列，也未重建 Runtime 或 Capability Snapshot。

## 测试

新增或扩展回归覆盖：

1. identity transition 期间 Todo、后台任务、Subagent 批量派遣和两类历史写命令统一拒绝同步旁路。
2. 切换已排队后调用异步 Subagent spawn，命令等待提交并使用目标 Session id/path。
3. Todo 创建和读取结果是脱离内部 Store 的副本，修改返回对象不影响权威状态。
4. AgentSession 监听器和 Runtime Session 监听器分别抛错时，后续监听器仍收到 `todo_update`。
5. 旧后台任务生命周期、Runtime 关闭和 RuntimeHost 历史控制器保持兼容。

已通过：

- `packages/coding-agent/test/agent-session-identity-transition.test.ts`：19 个测试。
- `packages/coding-agent/test/bash-block-until.test.ts` 与 `runtime-manager-close.test.ts`：8 个测试。
- `packages/coding-agent/test/background-task-observer-isolation.test.ts`：1 个测试。
- `packages/runtime-core/test/runtime-host/session-history-controller.test.ts` 与 `session-events.test.ts`：10 个测试。
- 根 TypeScript `bunx tsgo --noEmit -p tsconfig.json`：通过。
- `bun run check:quick`：通过。
- 完整 `bun run check`：Biome、monorepo/CLI/Desktop/Admin TypeScript 与 guards 全部通过。

## 下一步

下一阶段建议建立 Legacy identity replacement、Legacy memory rollover 与 Greenfield continuation 的统一差分矩阵，重点验证 Todo、后台任务、Subagent、历史写入和观察事件在三条路径上的保留/轮换规则。差分门禁稳定后，再按真实生产消费者清单逐项删除 Legacy Adapter 对 `AgentSession` 具体类型的依赖。
