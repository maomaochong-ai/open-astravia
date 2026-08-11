# 第 69 轮：Session-local Context Runtime 与原生压缩投影

## 目标

第 68 轮已经让 Prompt、Tool、Stop 与 Session lifecycle 共享唯一 Hook Runtime，但
Greenfield Profile 仍使用 passthrough Context Strategy。长会话不会生成摘要，
`context.compacted` 也只有早期计数记录，无法在重开后重建模型上下文。

本轮交付一个可验证的 Context 纵向切片：

```text
Conversation Document
  -> Session-local Context Runtime
  -> threshold / prefire / summary
  -> native context.compacted event
  -> summary + kept tail model projection
  -> reopen with the same model context

every model call
  -> transient microcompact
  -> no direct history mutation
```

本轮仍是并行 Greenfield 架构迁移，不替换旧 `AgentSession` 生产入口。

## 架构决策

### 1. Runtime Core 只定义通用执行合同

Kernel 新增两个不同生命周期的扩展点：

- `ContextStrategy`：在外部 Turn 的上下文准备阶段运行，可返回需要持久化的
  `ContextCompactionRecord`。
- `ModelCallContextTransformer`：每次 LLM 调用前运行，只返回 transient 消息视图，
  不直接写 Repository。

压缩阈值、摘要提示词、prefire 和 microcompact 仍属于 Coding Agent 产品能力，
没有下沉到 Runtime Core。

Profile 可以直接提供 Session-local Observer。Feature Compiler 将 Profile Observer
与 Feature Observer 合并到不可变 Snapshot，Context Runtime 因此可以读取实际
assistant usage，而不需要持有 AgentSession。

### 2. 压缩记录保存可重建事实

原计数记录：

```text
sourceMessageCount / resultMessageCount / optional summary
```

不能确定活动分支切点，也不能重建摘要消息。本轮新增原生记录：

```text
summary
summaryMessage
firstKeptEntryId
tokensBefore
details / fromHook
reason
```

`summaryMessage` 保存实际模型可见消息，而不是重开时重新拼接。这样未来提示词常量变化
不会改变历史会话的模型输入。

早期计数记录继续通过 TypeBox Schema 读取，但不会生成 Conversation Document 分支节点，
也不会改变模型投影。

### 3. 聊天历史与模型历史分离

原生压缩成为 Conversation Document 的真实分支节点。最新压缩后的模型投影为：

```text
exact summary message
  + firstKeptEntryId 到 compaction 之间的模型可见节点
  + compaction 之后的模型可见节点
```

聊天投影仍返回完整 user/assistant 历史。压缩不会从 UI 历史删除消息，也不会改写已经
持久化的原始消息。

Repository 关闭并重开后使用相同规则恢复；旧计数记录保持原有只推进 journal 的兼容语义。

### 4. 当前输入保持原子持久化

初版实现曾将 `turn.started` 与当前输入拆为两次 append，以便先写压缩节点。审计后撤销了
这个变化，因为它会改变失败 Turn 与崩溃恢复行为。

最终顺序保持：

```text
append(turn.started + input contexts + user message)
  -> prepare compaction from the pre-input document
  -> append(context.compacted)
  -> execute model
```

Context Strategy 同时收到：

- 写入前的持久历史 `historyMessages` 与 Conversation Document；
- 已组装的完整模型输入 `messages`。

因此摘要决策不吞入当前 Prompt，而当前输入仍与 `turn.started` 原子保存。压缩后的即时模型
视图将 Provider/当前输入作为 transient tail 补回；真正持久化后的 Document 也会自然包含
位于压缩节点之前的当前输入。

### 5. Session-local Coding Agent Context Runtime

每个 Greenfield Session 创建一个 `CodingAgentGreenfieldContextRuntime`，同一实例同时作为：

- Context Strategy；
- Model Call Context Transformer；
- Turn Observer；
- Conversation Document Participant；
- Session state 的 context usage 来源。

它复用既有纯算法和常量：

- `shouldCompact`、`prepareCompaction`、`compact`；
- `shouldPrefire`、前缀指纹和缓存校验；
- `microcompact`；
- `CompactionCircuitBreaker`；
- 既有压缩摘要前后缀。

PreCompact/PostCompact 使用第 68 轮的同一 Session Hook Runtime。Pre Hook 阻断时不生成、
不持久化压缩；成功记录持久化后再运行 Post Hook 并标记下一次 SessionStart source 为
`compact`。

成功 `compaction.end` 继续由已持久化的 `context.compacted` 事件映射，Context Runtime
不再重复发布第二个成功事件。失败路径发布单独的瞬时 end 事件。

Context usage 在 create/resume 时从 Document 模型投影恢复，运行中优先采用最后一条有效
assistant usage；因此宿主状态不再固定返回 `null`。

### 6. Schema 校验

本轮在文件存储边界使用既有 TypeBox，新增原生/旧版 compaction record 联合 Schema。
Session-local Strategy、Transformer、Observer 和 Document Participant 都是进程内已类型化
合同，不再重复增加 Zod/TypeBox 校验。

## 实施范围

### Runtime Core

- 增加可重建的原生压缩记录和旧记录联合类型。
- Context Strategy 获得 Session/Turn、模型绑定、历史、Document 与观察事件端口。
- 增加压缩提交回调和逐模型调用 Context Transformer。
- Agent Core 在每次 LLM 调用前运行 Transformer。
- Conversation Document 持久化原生压缩节点，并分离完整聊天与压缩后模型投影。
- 保持 `turn.started + input` 原子写入，压缩记录在准备成功后单独提交。

### Runtime Storage

- TypeBox 同时校验旧计数记录和原生压缩记录。
- 原生压缩参与 Document entry identity 与 parent 恢复。
- 文件 Repository 重开后恢复“摘要 + 保留尾部”模型上下文。

### Coding Agent

- 新增 Session-local Context Runtime。
- 接入旧 threshold、prefire、microcompact、摘要、熔断与 Hook 行为。
- 隐藏、模型不可见的 Context Document 节点不会进入压缩摘要。
- 增加 coding-agent Vitest 的 Runtime Core conversation alias。

### CLI Composition Root

- 每 Session 创建、注册和释放唯一 Context Runtime。
- 同一实例进入 Profile Strategy、Transformer、Observer 和 Document Participants。
- State Source 返回实际 context percent/context window，并在 resume 后立即可用。

## 验证

### Runtime Core

```text
bunx vitest --run \
  test/conversation/compaction-projection.test.ts \
  test/kernel/agent-core-turn-engine.test.ts \
  test/kernel/turn-pipeline.test.ts
```

结果：`3 files / 22 tests passed`。

覆盖原生/旧版投影、逐模型调用 transformer、输入原子写入、压缩提交顺序和既有 Pipeline
行为。

### Runtime Storage

```text
bunx vitest --run \
  test/conversation/compaction-persistence.test.ts \
  test/conversation/context-records.test.ts \
  test/conversation/file-conversation-repository.test.ts
```

结果：`3 files / 19 tests passed`。

覆盖原生压缩关闭/重开、旧 Context record 与完整文件 Repository 回归。

### Coding Agent

```text
bunx vitest --run test/runtime-core/greenfield-context-runtime.test.ts
```

结果：`1 file / 4 tests passed`。

覆盖阈值压缩、当前输入不进入摘要、Pre Hook 阻断、逐调用 microcompact 不改写历史、
Document usage 恢复和 assistant 精确 usage。

### CLI 真实组合

```text
bunx vitest --run test/greenfield-runtime-composition.test.ts
```

结果：`1 file / 11 tests passed`。

既有真实工具、文件持久化、resume、continue、动态工具、Prompt、MCP 与 Context 状态组合均通过；
新增断言确认 create/resume 的 context percent 一致。

### 类型与质量门禁

实施中已通过：

```text
bunx tsgo --noEmit -p tsconfig.json
bunx tsc --noEmit -p packages/cli-app/tsconfig.json
bun run check:quick
bun run check
```

## 明确未实施

- 未替换默认旧 `AgentSession` 或 RuntimeHost Backend。
- 未实现手动压缩命令。
- 未实现 provider context overflow 后压缩并自动重试。
- Layer 2 阈值压缩目前在外部 Turn 准备阶段触发；同一 Turn 的长 Tool Loop 中只有
  microcompact 每次调用运行，prefire/LLM 压缩尚未下沉到模型调用检查点。
- 未迁移 `session_before_compact` / `session_compact` Extension 自定义摘要合同。
- 未迁移 memory-mode 的 MEMORY flush、JSONL rollover、JOURNAL 和约 70% 阈值调整。
- 未把旧图片预算或其他产品 Context Transformer 夹带进本轮。

因此本轮是标准长会话压缩的第一个完整持久化切片，不代表全部旧 Context 行为已经可切换。

## 下一步

下一阶段应补齐模型调用后错误/用量驱动的 Compaction Orchestrator：

```text
model call checkpoint
  -> current usage / overflow
  -> serialized compaction request
  -> persisted compaction
  -> optional overflow retry
```

重点先覆盖同 Turn Tool Loop 跨阈值、overflow 删除错误消息并重试、取消/并发单飞、排队输入，
再增加手动压缩 Port。Extension 自定义压缩和 memory-mode rollover 应作为后续独立能力层，
不能与标准 Context Strategy 混成一个类。
