# 第 70 轮：模型调用级 Compaction Orchestrator

## 目标

第 69 轮已经交付 Session-local Context Runtime、原生压缩记录和逐模型调用
microcompact，但 Layer 2 摘要仍只在外部 Turn 开始时执行。长 Tool Loop 可能在同一
Turn 内跨过阈值；Provider 返回 context overflow 后也只能结束，无法先持久化压缩再重试。

本轮补齐以下纵向切片：

```text
Agent Tool Loop
  -> model-call / assistant-result / assistant-error checkpoint
  -> Turn Pipeline 按事件顺序完成前置消息持久化
  -> Session-local Context Strategy
  -> optional context.compacted commit
  -> PostCompact
  -> 放行下一次模型调用或一次 overflow retry
```

默认旧 `Agent`、旧 `AgentSession` 和生产入口保持不变。

## 问题分析

### 1. 原 EventStream 不提供背压

`agent-core` 的 `EventStream.push()` 只入队，不等待消费方处理。Tool Result 虽然在下一次
模型调用前发出，但 Agent Loop 可以在 Turn Pipeline 完成 Repository append 前继续运行。

因此下面这种实现不成立：

```text
message_end(toolResult)
  -> Pipeline 异步持久化
  -> transformContext 直接压缩
```

它存在两个竞态：

- 压缩可能看不到刚完成的 Tool Result。
- 模型调用可能在 `context.compacted` 提交前已经发出，崩溃后无法从事件日志判断实际使用的
  上下文。

### 2. 检查点必须是请求—应答协议

本轮没有把 Repository、压缩算法或 Coding Agent 类型传入 Agent Loop。Agent Loop 只新增
一个默认关闭的通用检查点事件：

```text
context_checkpoint {
  reason
  messages
  assistantMessage?
  recoveryAttempt
  complete(result?)
  fail(error)
}
```

启用后，Agent Loop 在收到 `complete` 前不会调用模型。`AgentCoreTurnEngine` 只做协议桥接；
`TurnPipeline` 作为唯一消费者，在处理检查点前已经按同一事件流顺序持久化之前的
assistant/toolResult。

普通 Agent 调用不启用 `contextCheckpoints`，不会产生新事件，也不会改变原执行路径。

## 实施内容

### 1. Agent Core：通用模型调用暂停点

`@vetta/agent-core` 增加三个检查点原因：

- `model_call`：每次模型调用前，transient transformer 已执行。
- `assistant_result`：自然完成的 assistant 已发出且 Turn End 已观察。
- `assistant_error`：Provider error assistant 已发出且 Turn End 已观察。

检查点结果分离两个消息视图：

- `messages`：当前一次模型调用使用的 transient 视图。
- `contextMessages`：持久压缩成功后替换 Tool Loop 内部上下文的视图。

这样 microcompact 不会错误改写 Agent 内部历史，而持久压缩又能让后续 Tool Loop 从摘要上下文
继续。检查点失败时 Agent Loop 会正常关闭内部事件流，不会继续发出模型调用。

Overflow 恢复成功后先重新读取 steering 队列，把用户在压缩期间提交的 steering 输入放到
重试调用前；follow-up 仍保持自然停止后消费的原语义。

### 2. Runtime Core：Pipeline-owned 持久化提交

`TurnEngineEvent` 增加进程内 `context_checkpoint` 请求—应答事件。它不是
`StoredSessionEvent`，不会写入 Conversation Repository。

Turn Pipeline 在检查点执行以下固定顺序：

```text
load latest conversation/document
  -> ContextStrategy.prepare(reason)
  -> append context.compacted
  -> ContextStrategy.onCompactionCommitted
  -> optional transient ModelCallContextTransformer
  -> complete checkpoint
```

`ContextStrategy` 仍然不知道 Repository；它只返回 `PreparedContext` 和可持久化记录。
`onCompactionCommitted` 返回 `continueExecution`，仅用于 PostCompact 要求停止时抑制
overflow retry，已经提交的压缩事实不会回滚。

Pipeline 每次传入最新 Conversation/Document、当前模型绑定、Provider transient 消息和
恢复次数。所有处理仍处于一个 Turn Snapshot lease 内；运行时工具、Prompt、Skill 的调用级
刷新边界不变。

### 3. Coding Agent：阈值、prefire 与 overflow 产品策略

`CodingAgentGreenfieldContextRuntime` 继续复用既有：

- `microcompact`；
- `estimateContextTokens` / `shouldCompact`；
- `shouldPrefire` 与前缀缓存；
- `prepareCompaction` / `compact`；
- `CompactionCircuitBreaker`；
- PreCompact/PostCompact Hook。

新增行为：

- `model_call` 使用当前调用视图估算，同一 Tool Loop 跨阈值时立即生成并提交摘要。
- `assistant_result` 使用最终 assistant usage，保持旧“成功 Turn 达阈值后压缩但不重试”行为。
- `assistant_error` 只接受与当前 Turn model binding 相同的 Provider/Model。
- Error pattern overflow 与 input usage 超过 context window 的 silent overflow 都生成
  `reason: "overflow"` 的持久压缩记录。
- 重试上下文移除已持久化的 overflow assistant；聊天历史仍保留该错误事实。
- 同一外部 Agent Loop 最多恢复一次，第二次 overflow 正常终止，避免无限循环。
- PostCompact `shouldStop` 会保留已提交摘要，但阻止自动重试。

Provider Context 是非持久消息。模型调用级压缩重建 Document 投影后，将这些消息重新插入
摘要与保留尾部之间，避免压缩时静默丢失调用级上下文。

### 4. 类型校验边界

本轮未引入 TypeBox 或 Zod。检查点是同进程、已类型化的请求—应答合同，不经过 JSON、磁盘、
RPC、插件或模型参数边界；重复运行时 parse 不增加安全性。持久 `context.compacted` 仍沿用
第 69 轮已有 TypeBox Schema。

## 行为兼容性

保持不变：

- `contextCheckpoints` 默认关闭，普通 Agent Loop 的事件和停止行为不变。
- 模型调用前仍先刷新动态 Prompt/Tool Frame，再执行 transient context transformer。
- Tool、Provider、Session Repository 与压缩算法的依赖方向不变。
- Overflow assistant 仍写入会话历史，只从自动重试的模型上下文移除。
- 非 overflow error 不重试，也不消费 follow-up。
- 用户取消不恢复；检查点失败不会继续调用模型。

本轮没有切换默认旧生产入口，也没有迁移手动压缩、Extension 自定义压缩或 memory-mode。

## 测试

### Agent Core

```text
bunx vitest --run test/agent-loop.test.ts
```

覆盖模型调用放行、检查点失败停止、error 恢复一次、恢复期间 steering 输入和普通默认路径。

### Runtime Core

```text
bunx vitest --run \
  test/kernel/agent-core-turn-engine.test.ts \
  test/kernel/turn-pipeline.test.ts
```

覆盖 Agent Core 到 Kernel 的有序桥接、Tool Result 先持久化再提交压缩、取消中的检查点拒绝和
既有 Pipeline 行为。

### Coding Agent

```text
bunx vitest --run test/runtime-core/greenfield-context-runtime.test.ts
```

覆盖同 Turn threshold、Provider transient 保留、同模型 error overflow、单次恢复限制、
silent overflow、错误消息剔除、Hook 与 microcompact。

### CLI Composition Root

```text
bunx vitest --run test/greenfield-runtime-composition.test.ts
```

验证真实 Greenfield 组合在新增模型调用检查点后继续保持 Prompt、工具、MCP、文件持久化、
resume、continue 和动态能力行为。

## 明确未实施

- 未新增手动压缩 Port。
- 未迁移 `session_before_compact` / `session_compact` Extension 自定义摘要。
- 未迁移 memory-mode 的 MEMORY flush、JSONL rollover、JOURNAL 和约 70% 阈值。
- 未替换默认旧 `AgentSession` 或 RuntimeHost Backend。
- 未增加跨进程检查点协议；当前合同刻意保持为 Kernel 内部进程对象。

## 下一步

下一阶段应把手动压缩做成 Session/Runtime Port，并让标准压缩与 Extension 自定义摘要共享同一
持久提交路径，但不要把 Extension runner 放进 Runtime Core。随后独立迁移 memory-mode 的
Memory Flush 与 Rollover Orchestrator，并补齐分支、取消、失败恢复和文件切换事件合同。
