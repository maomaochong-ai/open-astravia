# 第 72 轮：跨 Conversation Turn 续接事务

## 1. 目标

为 Greenfield Runtime 建立 memory-mode rollover 所需的通用事务边界，但不在本轮迁移
MEMORY flush、JOURNAL 或 IM 触发策略。

成功标准：

- 压缩提交后可以在同一个 Turn、同一个 Tool Loop 中切换到新的持久化 Conversation。
- 不用第二个 `turn.started` 伪造新 Turn。
- 源会话、目标会话在崩溃恢复时都有明确生命周期。
- AgentSession ID、模型调用、工具、投影和宿主路径一起重绑定。
- 新文件只保留最近 compaction 与 kept tail，行为与旧 rollover 语义一致。
- 持久化输入使用 TypeBox 校验，版本冲突不留下目标文件。

## 2. 旧行为与问题

旧 `CompactionController` 会在自动压缩完成后直接调用
`SessionManager.rolloverToNewFile()`。该调用发生在模型调用检查点中，因此后续模型和工具仍属于
当前 Turn，而不是下一次用户输入。

Greenfield 第 71 轮之前存在四个静态假设：

1. `AgentSession.id` 创建后不变。
2. `TurnPipeline.run(sessionId)` 在整个 Turn 内固定使用同一个 ID。
3. `GreenfieldSessionProjection` 只能投影一个 Conversation。
4. Runtime Host 的 lifecycle path 在 Assembly 创建时固定。

仅在 Storage 中创建新文件会造成“日志已切换、运行时仍写旧文件”；仅改变内存 ID 又会让旧
会话保留未完成 Turn。两者都不能接受。

## 3. 协议设计

续接使用一对持久事实：

```text
source
  turn.started
  ...
  context.compacted
  turn.transferred { targetSessionId, turnId }

target
  continuation seed
  turn.continued { sourceSessionId, turnId, snapshotId }
  ...
  turn.completed | turn.cancelled | turn.failed
```

关键语义：

- `turn.transferred` 是源 Conversation 的合法终态。
- `turn.continued` 是目标 Conversation 的活动 Turn 起点，不是新的 Turn。
- 两个事件共享原 `turnId` 和绑定的 `snapshotId`。
- 目标 seed 不计入 Kernel event version；它是目标 Document 的初始状态。
- 运行时先发布源 transfer，再用瞬时 `conversation.continued` 重绑定投影，最后发布已经落盘的
  target continued 事件。

这使恢复策略可以分别处理两个文件：源文件已经闭合；目标文件如果没有终态，只会被标记为
interrupted，不会重放模型、工具或进程内队列。

## 4. 实施内容

### 4.1 Runtime Core

- 新增 `ConversationContinuationStore`、输入/结果合同和通用 continuation directive。
- `ContextCompactionCommitResult` 可以在提交后请求续接；Kernel 不解释原因。
- 新增 `turn.transferred`、`turn.continued` 和瞬时 `conversation.continued`。
- `FailInterruptedTurnRecoveryPolicy` 将 transfer 视为终态、continued 视为活动 Turn 起点。
- `TurnPipeline` 使用可变 `TurnSessionIdentity`：
  - 存储事务成功后立即更新 Session ID。
  - 后续 Context Checkpoint、Tool Policy、Tool Execution、动态 Prompt、Observer 和终态读取新 ID。
  - `TurnResult` 返回最终 `sessionId`。
- `AgentCoreTurnEngine` 的 session ID 改为动态 getter，避免同 Turn 后续调用继续捕获旧身份。
- `AgentSession.id` 变为共享身份的只读 getter，对外仍不可任意赋值。

### 4.2 Conversation Document

- 新增经过图完整性校验的 seeded Document 构造函数。
- rollover seed 使用独立 `seed-N` identity，避免与目标文件后续 `event-N` 冲突。
- 模型消息投影同时支持两种 compaction 形态：
  - 普通会话：kept tail 位于 compaction 之前。
  - rollover 会话：compaction 是 seed 根，kept tail 位于其后。
- UI 消息投影仍不显示 summary message，模型投影继续得到 `summary + kept tail`。

### 4.3 Runtime Storage

- `FileConversationRepository` 实现跨 Conversation 续接事务。
- 在源文件锁和乐观 version 下校验：
  - V2 可写 Schema。
  - 当前唯一活动 Turn。
  - 最近原生 compaction。
  - `firstKeptEntryId` 位于 compaction 前的活动分支。
- 目标 header 保存 `parentSessionPath` 与源 compaction entry ID。
- 目标 seed 携带 compaction、kept tail、compaction 后条目，并重写 parent chain。
- TypeBox 为所有 Conversation Document entry 变体、seed record 和新增生命周期事件提供运行时校验。
- 先以独占创建写入目标文件，再追加源 transfer；普通异常会删除本次新建目标文件。
- version conflict 在创建目标前失败。

跨两个普通文件无法获得真正的文件系统级二阶段原子提交。若进程恰好在目标创建后、源 transfer
前崩溃，两个文件都包含未闭合 Turn；恢复时二者都只会收敛为 interrupted，不会自动重放外部
副作用。后续若需要隐藏 orphan target，应由 Session Catalog/索引层增加 reconciliation，不能让
Turn Pipeline 扫描目录。

### 4.4 Greenfield Runtime Host

- `GreenfieldSessionProjection` 支持用目标 seed 整体替换事实源，再继续增量应用 target event。
- Event Sink 在瞬时续接事件上同步：
  - Conversation projection。
  - cwd、session path 与 parent lineage。
  - Document Participant。
- 新增稳定宿主事件 `session.path_changed`。
- Greenfield Session、Lifecycle Port、History 命令和 Workspace View 改为读取动态身份。

### 4.5 CLI Composition Root

- 显式把 `FileConversationRepository` 同时绑定为 continuation store。
- Hook 的 session ID/transcript path 改为读取活动身份。
- Plugin invocation session 和 MCP controller 索引在续接后重绑定。
- 默认旧 CLI/RuntimeHost 入口仍未切换。

## 5. 明确未修改

- 没有启用 memory-mode，也没有改变约 70% 阈值。
- 没有迁移 MEMORY.md flush、memory tool、JOURNAL 或日期 cwd。
- 没有修改旧 `SessionManager.rolloverToNewFile()` 生产路径。
- 没有把文件路径、TypeBox Schema 或 IM 策略放进 Runtime Core。
- 没有把 rollover 实现成新的 Turn、follow-up 或普通 Pipeline middleware。
- 没有改变 Tool 名称、描述、Schema、执行结果或激活规则。

## 6. 测试

新增测试：

- Storage 续接事务：
  - 源 transfer 与目标 continued。
  - compaction + kept tail seed 重建。
  - parent lineage。
  - 关闭重开。
  - version conflict 不创建目标文件。
- Pipeline 纵向测试：
  - 模型调用检查点请求 rollover。
  - AgentSession 在同 Turn 中更新 ID。
  - Engine 在检查点后读取目标 ID。
  - assistant 和 terminal 写入目标文件。
  - Runtime 重绑定失败时，目标文件仍能写入 `turn.failed`。
  - 源、目标恢复计划均为 ready。
- Greenfield 投影与宿主路径事件测试。

执行结果：

```text
runtime-core
  新续接测试：1 passed
  turn-pipeline / recovery / AgentCoreTurnEngine / Greenfield Backend：40 passed

runtime-storage
  新续接测试：4 passed
  Conversation 测试：33 passed

cli-app
  Greenfield Runtime Composition：12 passed

repository root
  bun run check:quick：passed
```

当前 Bun 直接启动 Vitest 的 worker 在 Windows 报 `File URL path must be an absolute path`；
改用工作区随 Codex 提供的 Node 可执行文件运行同一 Vitest 入口后，上述测试通过。

完整 `bun run check` 中，本轮相关 Biome、monorepo tsgo、cli-app 和 desktop-app 类型检查已通过；
最终被 admin 本地缺失的 `@types/d3-*`、`@types/estree` 和 `@types/json-schema` 声明文件阻断。
这是依赖安装状态问题，本轮没有删除或降级 admin 代码/类型来规避。

本轮同时补齐 runtime-storage Vitest 对 `@vetta/runtime-core/kernel` 的源码 alias；此前无法收集的
`legacy-session-document-reader.test.ts` 已恢复执行，九个 Conversation 测试文件全部通过。

## 7. 结果

Greenfield 已具备通用的跨 Conversation 续接内核：

```text
产品策略请求 continuation
  -> Turn Pipeline
  -> ConversationContinuationStore
  -> source transfer + target seed/continued
  -> Session identity / projection / host path rebind
  -> same Turn continues
```

该能力是 memory-mode 的必要基础，但不是 memory-mode 本身。它没有让 Runtime Core 知道
MEMORY、JOURNAL、IM 或具体阈值。

## 8. 下一步

下一阶段应在 Coding Agent 产品层建立独立 Memory Rollover Orchestrator，一次完成：

1. 复用旧约 70% compaction setting。
2. 压缩提交前后执行既有 best-effort MEMORY flush。
3. 在提交回调中返回通用 continuation directive。
4. rollover 成功后追加既有 JOURNAL section。
5. 用旧新差分测试验证 flush 失败不阻止 rollover、JOURNAL 失败不破坏 Turn、memory snapshot
   仍只在会话开始冻结。

Orchestrator 可以调用现有 memory 模块和 Context Runtime，但不能进入 Runtime Core、Storage
Schema 或 `ContextCompactionCommitter`。
