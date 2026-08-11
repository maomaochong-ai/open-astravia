# 第 71 轮：Session 手动压缩与统一提交边界

## 1. 目标

在不改变旧压缩功能的前提下，为 Greenfield Session 补齐手动压缩能力，并让外部 Turn
开始时的自动压缩、同 Turn 模型调用检查点压缩和手动压缩共享同一个持久化提交边界。

本轮成功标准：

- Runtime Core 只编排 Session 状态、取消、Snapshot lease 和持久化，不实现摘要算法。
- Coding Agent 继续拥有 threshold、overflow、prefire、摘要、Hook 和 Extension 语义。
- 手动压缩不伪造 Turn；持久事件允许在两个 Turn 之间没有 `turnId`。
- 旧手动压缩的自定义指令、Extension 覆盖/取消、Pre/PostCompact、自动压缩开关和错误文本保持不变。
- CLI Greenfield Composition Root 能组装并执行真实手动压缩链路。

## 2. 边界分析

手动压缩不是 Turn Pipeline 的一个伪 Turn，也不应让宿主直接写 Repository。最终边界为：

```text
RuntimeSessionContextController
  -> cancel active Turn
  -> acquire RuntimeSnapshot lease
  -> load Conversation + Document
  -> ManualContextCompactionRuntime.compactManual
  -> ContextCompactionCommitter.commit
  -> onManualCompactionCommitted
  -> release lease
```

职责归属：

| 层 | 职责 |
| --- | --- |
| Runtime Core | Session 忙碌态、取消、Snapshot lease、乐观版本、事件提交、Observer 通知 |
| Coding Agent | 压缩准备、模型摘要、Extension 覆盖/取消、Pre/PostCompact、自动压缩配置 |
| Runtime Storage | TypeBox 校验、无 `turnId` 手动记录持久化、Document 投影与重开恢复 |
| CLI Composition Root | 选择具体 Context Runtime、Extension Adapter 和摘要实现 |

`ContextCompactionCommitter` 是提交原语，不是另一套压缩策略。Turn Pipeline 的 threshold/overflow
路径和 Session Controller 的 manual 路径都调用它，因此不会形成两套事件顺序或 Observer
通知逻辑。

## 3. 实施内容

### 3.1 Runtime Core

- 新增 `ManualContextCompactionRuntime`，只描述手动压缩算法端口、提交后回调和自动压缩开关。
- 新增 `RuntimeSessionContextController`，向宿主暴露 `compact`、`abortCompaction`、
  `readState` 和 `setAutoCompactionEnabled`。
- 新增 `GreenfieldSessionContextController`：
  - 手动压缩前取消活动 Turn。
  - 压缩期间阻止 prompt、continue、history write 和会话命名等并发操作。
  - 使用 Snapshot lease 固定本次操作所依赖的运行时资源。
  - 使用 Repository version 执行乐观并发提交。
- 新增 `ContextCompactionCommitter`，统一提交 `context.compacted`、发布 Kernel Event、
  通知 Observer 并返回提交后的 Conversation Document。
- Turn Pipeline 的 Turn-start 和 model-call checkpoint 压缩改为复用该 Committer。
- `context.compacted.turnId` 改为可选：
  - threshold/overflow 必须位于活动 Turn 内并携带 `turnId`。
  - manual 必须位于 Turn 外且不携带 `turnId`。
- 恢复策略显式校验上述协议，非法序列继续 fail closed。
- 手动压缩持久事件不额外映射成宿主 `compaction.end`，保持旧手动 `compact()` 不发送
  auto-compaction 事件的行为。

### 3.2 Runtime Storage

- Conversation V2 TypeBox Schema 允许 `context.compacted.turnId` 缺省。
- 原生 Document 投影继续按同一 compaction node 语义恢复“摘要 + 保留尾部”。
- 新增关闭并重开 Repository 的测试，验证手动记录没有伪造 Turn ID 且投影稳定。

### 3.3 Coding Agent

- `CodingAgentGreenfieldContextRuntime` 实现 `ManualContextCompactionRuntime`。
- 手动路径复用旧有 `prepareCompaction` 和 `compact`：
  - 保留 `No model selected`、`No API key`、`Already compacted`、
    `Nothing to compact` 和 `Compaction cancelled` 错误语义。
  - 自定义指令继续传给 Extension 和摘要模型。
  - PreCompact 阻断继续中止操作。
  - Extension 提供摘要时不调用模型，并记录 `fromHook`。
  - 提交成功后才调用 `session_compact`、PostCompact 和 `markSessionStart("compact")`。
- 新增窄化的 `CodingAgentCompactionExtensionRuntime` 及旧 `ExtensionRunner` Adapter；
  Runtime Core 不导入 Extension 类型。
- 自动压缩与手动压缩共用 Context Runtime，但保留各自触发与事件语义。
- Legacy Session 增加同一 `RuntimeSessionContextController` 适配，旧生产实现继续可由稳定 Port 使用。

### 3.4 CLI Composition Root

- Greenfield 组合选项增加可注入的压缩设置、摘要函数和 Session-local Extension Runtime 工厂。
- 每个 Session 创建独立 Context Runtime，并将其同时交付给 Context Strategy、
  model-call transformer、Observer 和 Session Context Controller。
- 默认旧 CLI/RuntimeHost 入口未切换。

## 4. 明确未修改

- 没有修改压缩摘要 Prompt、token 估算、切点算法、prefire 或 circuit breaker 产品语义。
- 没有把 Extension Runner、Settings Manager 或 Session Manager 放入 Runtime Core。
- 没有把手动压缩实现为伪 Turn。
- 没有修改旧 `AgentSession.compact()` 生产路径。
- 没有迁移 memory-mode 的 MEMORY flush、rollover 或 JOURNAL。
- 没有新增 TypeBox/Zod 到进程内已类型化的 Controller/Strategy 输入；TypeBox 只修改了持久化边界。

## 5. 测试

已执行：

```text
packages/runtime-core
  bunx vitest --run test/runtime-host/greenfield-session-backend.test.ts
    test/kernel/conversation-recovery.test.ts
    test/kernel/turn-pipeline.test.ts
  30 passed

packages/coding-agent
  bunx vitest --run test/runtime-core/greenfield-context-runtime.test.ts
  9 passed

packages/runtime-storage
  bunx vitest --run test/conversation/compaction-persistence.test.ts
  2 passed

packages/cli-app
  bunx vitest --run test/greenfield-runtime-composition.test.ts
  12 passed

repository root
  bun run check:quick
  passed

  bun run check
  passed（Biome、monorepo tsgo、cli-app、desktop-app、admin、quality guards）
```

首次完整检查发现测试把可选 `onManualCompactionCommitted` 直接作为 `vi.fn` 泛型，类型中包含
`undefined`。测试改用 `NonNullable` 精确收窄后，相关测试、快速检查和完整检查均重新通过；
运行时实现未因此改变。

覆盖的关键合同：

- Turn-start/checkpoint/manual 三条路径共享提交原语。
- 手动记录在 Turn 外合法、Turn 内非法；自动记录缺少 Turn ID 非法。
- Repository 重开后仍得到摘要与保留尾部。
- 压缩期间 Session 操作返回 `session_busy`，显式取消传播 AbortError。
- Extension 摘要覆盖跳过模型调用，取消不落盘、不调用提交后 Hook。
- 手动压缩不产生额外宿主 SessionEvent。
- CLI 真实 Composition Root 能完成手动压缩并写入 History。

## 6. 结果

Greenfield 标准上下文压缩现在形成一个稳定结构：

```text
触发器（Turn start / model checkpoint / manual Session command）
  -> Coding Agent Context Runtime
  -> Runtime Core ContextCompactionCommitter
  -> Conversation Repository
```

触发器与压缩算法可以独立演进，持久化顺序只有一个事实源。Runtime Core 不绑定 Coding
业务，Coding Agent 不直接写存储，宿主也不需要获得内部 Session Manager。

## 7. 下一步

下一阶段应迁移 memory-mode 的独立 Orchestrator，但需要继续拆开三个边界：

1. MEMORY flush：跨会话记忆写入能力与模型调用。
2. rollover：新会话文件创建、血缘和路径切换事件。
3. JOURNAL：工作史追加副作用。

它们不能并入 `ContextCompactionCommitter` 或 `ContextStrategy`。标准摘要压缩只改变当前
Conversation Document；memory-mode 会创建新持久化实体并产生宿主路径切换，是不同的事务边界。
