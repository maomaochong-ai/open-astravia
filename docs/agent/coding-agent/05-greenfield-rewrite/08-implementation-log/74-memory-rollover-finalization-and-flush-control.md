# 第 74 轮：Memory Rollover 时序兼容与主动 Flush 控制

## 1. 本轮目标

关闭第 73 轮留下的两个迁移阻断项：

1. 让 Greenfield 自动压缩后的 JOURNAL、Conversation rollover、Extension committed、PostCompact 和
   overflow retry 决策顺序与旧 `CompactionController` 一致。
2. 为短会话尚未触发 rollover 就被宿主丢弃的场景，提供 Greenfield 按需 MEMORY flush 控制边界。

默认生产 `AgentSession`、RPC、IM 和 Desktop 入口继续保持不变。

## 2. 旧行为基线

旧自动压缩实际顺序为：

```text
PreCompact
  -> MEMORY flush discarded prefix
  -> Extension beforeCompaction
  -> generate / apply compaction
  -> append compaction
  -> append rollover JOURNAL
  -> rolloverToNewFile / session_path_changed
  -> replace agent messages
  -> Extension session_compact
  -> PostCompact
  -> circuit breaker success
  -> decide overflow retry
```

如果 rollover 失败，JOURNAL 已经 best-effort 写入，但 Extension committed、PostCompact 和成功记录不会
执行；失败进入熔断计数。

旧主动 `AgentSession.flushMemory()`：

- 只在 memory-mode、存在 memory file、模型和 API key 时运行。
- 使用当前活动分支的完整模型上下文，不只使用压缩丢弃前缀。
- 空上下文或缺少前置条件返回 `0`。
- 复用 `flushMemoryBeforeRollover()`，返回实际写入条目数。
- 非 memory-mode 是稳定 no-op。

## 3. Runtime Core 合同

`ContextStrategy` 新增两个可选、通用的 continuation 生命周期回调：

```text
onCompactionCommitted
  -> optional continuation directive
  -> Pipeline continuation transaction + identity rebind
  -> onCompactionContinuationCommitted

transaction failure
  -> onCompactionContinuationFailed (best-effort)
  -> preserve original transaction error
```

Runtime Core 只传递 `ContextCompactionRecord`、`ConversationContinuationResult` 和最终
`continueExecution`，不理解 Memory、JOURNAL、Extension 或 Hook。

`TurnPipeline` 将 Turn-start 和模型调用 checkpoint 的重复提交后流程收敛到同一内部方法。成功
finalization 可以覆盖最终 `continueExecution`，因此 PostCompact stop 能在 rollover 已提交后阻止
overflow retry。continuation 失败通知本身失败时只产生观察诊断，不替换原始事务错误。

## 4. Coding Agent 时序实现

Memory Orchestrator 的职责调整为：

- `beforeCompaction()`：flush 即将丢弃的消息前缀。
- `beforeContinuation()`：在通用 rollover 事务前 best-effort 写 JOURNAL section。
- `continuationAfterCompaction()`：只返回通用 directive。
- `flushMessages()`：自动和主动 flush 共用的唯一文件写入入口。

Coding Agent Context Runtime：

- 非 memory-mode 继续在 `onCompactionCommitted()` 中完成 Extension/PostCompact。
- memory-mode 在 `onCompactionCommitted()` 中只写 JOURNAL 并请求 continuation。
- continuation 和身份重绑定成功后，才使用目标 seed document 运行 Extension committed、PostCompact
  和熔断成功记录。
- continuation 事务失败时记录熔断失败。
- rollover seed 会重写 entry id 与 `firstKeptEntryId`；Extension 回调在 continuation 路径按最新摘要
  找到目标 compaction entry，不错误要求旧切点 id 与目标重写 id 相等。

## 5. 主动 Memory Controller

新增 `CodingAgentGreenfieldMemoryController`：

```text
Host / Composition Root
  -> read active Conversation model projection
  -> read current model
  -> resolve current model API key
  -> Memory Runtime.flushMessages
  -> written count
```

Controller 位于 Coding Agent Adapter 层。CLI Greenfield Composition Root 对宿主暴露：

```ts
flushMemory(sessionId: string, signal?: AbortSignal): Promise<number>
```

它按活动 Session id 查找 memory controller；非 memory-mode 或已失效的旧 rollover id 返回 `0`。
Conversation rollover 后 Controller 索引与 MCP/Plugin 一样重绑定到新 Session id。

## 6. TypeBox / Zod 判断

本轮没有新增外部 JSON payload：

- continuation finalization 是 Kernel 内部已类型化回调。
- `flushMemory(sessionId, signal)` 是进程内 Composition API。
- MEMORY Tool 和持久 continuation 数据继续使用既有 TypeBox Schema。

因此没有在内部对象上重复增加 TypeBox/Zod。后续真实 RPC/IM Adapter 接入 Greenfield 时，应在其现有
命令反序列化边界继续校验外部 payload。

## 7. 测试

### Runtime Storage / Pipeline

5 项跨 Conversation Pipeline 集成测试通过，新增覆盖：

- continuation 和运行时重绑定后才执行成功 finalization。
- continuation Store 失败只执行失败通知，不执行成功 finalization。
- Post-continuation `continueExecution: false` 阻止 overflow retry。

### Coding Agent

Context Runtime、Memory Context 和 Memory Orchestrator 共 16 项通过，新增覆盖：

- `JOURNAL -> continuation -> Extension -> PostCompact` 顺序。
- rollover seed id 重写后仍能发送 Extension committed。
- PostCompact stop 只在 continuation 成功后生效。
- 自动 flush 和主动 flush 共用消息级入口。

### CLI Composition Root

Memory 与既有 Composition Root 共 16 项通过，新增覆盖：

- 非 memory-mode 主动 flush 返回 `0`。
- 主动 flush 使用当前活动分支的 user/assistant 上下文、当前模型和凭据。
- rollover 后旧 Session id 不再控制 Memory，新 Session id 可以继续主动 flush。

### 完整质量门禁

- `bun run check:quick`：通过。
- `bun run check`：通过；覆盖 Biome、根 `tsgo`、CLI 独立 typecheck、Desktop `tsc`、
  Admin `tsc -b` 与全部质量守卫。

## 8. 明确未修改

- 没有切换默认生产后端。
- 没有修改旧 `AgentSession.flushMemory()` 或 `flush_memory` RPC 响应。
- 没有把 Memory Controller 加入 Runtime Core Session Assembly。
- 没有向 Kernel Event 或 Storage Schema 写入 Memory/Extension/Hook 字段。
- 没有改变 memory Tool、MEMORY 文件格式或 JOURNAL 文案。

## 9. 下一步

下一阶段应进行真实宿主显式 opt-in：

1. 将 Greenfield Memory Controller 适配到 RPC/IM 现有 `flush_memory` 调用点，同时保留旧路径。
2. 建立同一宿主请求在 Legacy 与 Greenfield 下的命令响应、事件顺序、Session path 和文件副作用差分。
3. 增加 `/new`、会话丢弃、rollover 后 flush、恢复会话和并发关闭场景。
4. 只有显式 opt-in 的宿主验证完成后，才评估默认入口切换；本阶段仍不删除旧代码。
