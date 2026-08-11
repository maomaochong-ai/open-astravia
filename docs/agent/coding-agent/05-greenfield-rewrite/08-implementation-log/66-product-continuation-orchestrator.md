# 第 66 轮：产品级 Continuation Orchestrator 与 Todo/Plugin/Stop Hook 收敛

## 目标

第 64 轮给 Runtime Core 建立了唯一的通用 `ContinuationPolicy`，但 Greenfield CLI 直接把
`CodingAgentPluginRunOrchestrator` 作为最终 Policy，Todo 和 Ecosystem Stop Hook 还没有进入同一
产品编排边界。

本轮只收敛既有自然停止功能，不改变它们的业务语义：

```text
用户已排队 follow-up
  -> Todo continuation
  -> Plugin requested continuation
  -> Plugin continuation provider
  -> Ecosystem Stop Hook
  -> 真正结束
```

Runtime Core 不增加 Todo、Plugin 或 Hook 合同，旧 `AgentSession` 默认入口不切换。

## 既有行为基线

### 1. 用户 follow-up 在产品策略之前

旧 Agent 的真实流程不是“Policy 直接返回给模型”，而是：

```text
continuationProvider 产生自动消息
  -> 追加到已有 followUpQueue 尾部
  -> 按 all / one-at-a-time 取队列
```

因此用户运行期间已经排队的 follow-up 必然先于 Todo、Plugin 和 Stop Hook。Greenfield Runtime
Core 已采用同一语义：Policy 消息先 `enqueueFollowUps()`，再 `takeFollowUps()`。

### 2. 产品内部优先级

旧 `AgentSession.continuationProvider` 的代码顺序明确是：

1. `InputPipeline.buildTodoContinuationMessages()`
2. `RuntimeManager.collectPluginContinuationMessages()`
3. `EcosystemHookRuntime.runStop()`

任何前序来源返回非空消息后，本次自然停止不调用后序来源。

### 3. Todo 语义

- 空列表或全部完成：不续跑。
- 锁定的 Scene Todo：只要有未完成项，每次自然停止都强制续跑。
- 普通 Todo：同一待办状态签名只提醒一次，再次无进展停止时允许退出。
- 新的外部用户 Turn 会重置普通 Todo 的提醒签名。
- Todo 没有统一最大续跑次数；不能套用 Plugin 的 8 次上限。

### 4. 失败语义

- Todo 读取位于旧 provider 顶层；异常不会被通用编排器吞掉。
- Plugin Provider 自己逐项隔离失败，并继续后续 Provider。
- Stop Hook 的适配运行时负责自己的 adapter 失败语义。

因此本轮没有新增“所有来源一律 catch 后继续”的行为，以免把架构重构变成功能变更。

## 实施内容

### 1. 产品级 Continuation Orchestrator

新增：

```text
CodingAgentContinuationOrchestrator
  ├─ todo?: CodingAgentContinuationSource
  ├─ plugin?: CodingAgentContinuationSource
  └─ stopHook?: CodingAgentContinuationSource
```

它对 Runtime Core 仍只实现一个 `ContinuationPolicy`。每次自然停止按固定产品顺序调用来源，返回
第一个非空结果。取消信号已经触发时不调用任何来源；来源异常原样传播。

`CodingAgentPluginRunOrchestrator` 保持原有公开合同和 Session 状态，但在 CLI 组合中不再直接占用
Profile 的最终 Policy 槽，而是作为统一编排器的 Plugin Source。这样 Prompt、Tool、requested
continuation、Provider continuation 和幂等状态仍由同一个 Plugin Run 对象管理。

### 2. Session-local Todo Continuation Source

新增 `CodingAgentTodoContinuationSource`，内部复用旧
`buildTodoContinuationMessages()`，没有复制 Todo 提醒文案或重写决策。

它只持有两个 Session-local 状态：

- `lastTurnId`
- `lastNudgeSignature`

同一 Runtime Turn 内的自动 continuation 不重置签名；新的外部 Turn ID 才重置。这与旧
`InputPipeline.prompt()` 在新用户 Prompt 前重置签名等价。

同时把旧纯函数的输入收窄为最小 `TodoContinuationState`：

```text
getAll()
isLocked()
```

并增加默认仍为 `Date.now` 的可注入时钟，便于差分测试。旧 `TodoStore` 和旧调用方保持兼容。

### 3. Stop Hook Source

新增 `CodingAgentStopHookContinuationSource`：

1. 从完整 Runtime 消息中提取最后一条有效 Assistant 文本。
2. 调用 Session 绑定的 `CodingAgentStopHookInvoker`。
3. 把每个 Hook continuation fragment 原样转换成普通 `UserMessage`。

它不解释 Claude/Codex Hook 配置、不创建 Hook Runtime，也不改变 Hook adapter 的错误和重入规则。

### 4. CLI Session-local 组合

`createGreenfieldRuntimeComposition()` 新增两个可选 Session 工厂：

```text
createTodoContinuationState(sessionOptions)
createStopHookInvoker(sessionOptions)
```

Composition Root 为每个 Session 分别创建 Todo Source、Plugin Run Source、Stop Hook Source 和最终
Continuation Orchestrator：

```text
profile.continuationPolicy = CodingAgentContinuationOrchestrator
```

Todo 状态工厂必须返回与该 Session 的 Todo Tool 共享的状态；本轮没有创建第二份隐藏 TodoStore。
没有任何 continuation 来源时，Profile 仍不安装 Policy。

## 测试

### Agent Loop

```text
bunx vitest --run test/agent-loop.test.ts
```

结果：`9 passed`。

验证 Agent Loop 的自然停止回调、完整消息上下文与自动续跑没有回归。

### Runtime Core

```text
bunx vitest --run \
  test/kernel/session-input-queue.test.ts \
  test/kernel/agent-core-turn-engine.test.ts
```

结果：`12 passed`。

覆盖：

- 用户 follow-up 排在 Policy 消息之前。
- `one-at-a-time` 分次交付。
- `all` 模式批量交付。
- 错误终态不消费 follow-up。
- Policy 消息仍进入普通队列。

### Coding Agent

```text
bunx vitest --run \
  test/runtime-core/greenfield-continuation-orchestrator.test.ts \
  test/runtime-core/greenfield-plugin-run-orchestrator.test.ts \
  test/runtime-core/greenfield-plugin-tool-runtime.test.ts
```

结果：`10 passed`。

覆盖：

- Todo、Plugin、Stop Hook 固定优先级。
- 前序非空时后序来源不执行。
- 取消前不调用来源。
- 来源异常不被通用编排器吞掉。
- 普通 Todo 同签名只提醒一次，并在新 Turn 重置。
- 锁定 Todo 持续提醒。
- 两个 Session 的 Todo nudge 状态隔离。
- Stop Hook 取得最后 Assistant 文本并保留多个 fragment。
- Plugin Provider 失败隔离、幂等、次数限制和 Tool requested continuation 保持原测试通过。

### CLI 端到端

```text
bunx vitest --run \
  test/greenfield-continuation-orchestrator.test.ts \
  test/greenfield-plugin-runtime.test.ts \
  test/greenfield-plugin-tool-runtime.test.ts
```

结果：`3 passed`。

真实文件会话中连续验证：

```text
初始 Assistant
  -> Todo User Message
  -> Assistant 完成 Todo
  -> Plugin User Message
  -> Assistant
  -> Stop Hook User Message
  -> 最终 Assistant
  -> 结束
```

Todo 状态在运行期间动态改为完成后，下一次自然停止立即转入 Plugin；Plugin 幂等键重复后立即转入
Stop Hook。四条 User Message 和四条 Assistant Message 均按原顺序持久化。

### 质量门禁

```text
bun run check:quick
bun run check
```

最终结果：全部通过。完整门禁执行了 Biome、根 monorepo 类型检查、CLI 独立类型检查、Desktop、
Admin 和质量 guards。

第一次完整检查只发现新增测试 helper 的同步/异步 Mock 返回类型不够精确。实现未降级；测试 Mock
改为显式异步后，第二次完整检查通过。

## 修改范围

- `packages/coding-agent`
  - 产品级 Continuation Orchestrator。
  - Todo 与 Stop Hook Source。
  - Todo 纯函数的最小状态接口和可测试时钟。
  - Greenfield 公共导出与单元测试。
- `packages/cli-app`
  - Session 级 Todo/Stop Hook 工厂、最终 Policy 组合和端到端测试。
- 本实施日志与索引。

## 明确未实施

- 未修改 Runtime Core 的 `ContinuationPolicy` 或队列实现。
- 未修改旧 `AgentSession.continuationProvider`。
- 未切换旧 RuntimeHost / Desktop 默认生产入口。
- 未迁移 Todo Tool、Todo 持久化恢复或 Todo Session Controller 到 Greenfield Tool Profile。
- 未在 CLI 内部创建 Ecosystem Hook Runtime；只接入明确的 Session bridge。
- 未给 Todo 增加 Plugin 式次数上限。
- 未改变 Plugin Run Orchestrator 的 Provider 排序、失败隔离、幂等或 8 次上限。

## 下一步

下一阶段应迁移完整的 Session-local Todo Runtime，而不是继续扩充 Continuation Orchestrator：

```text
TodoStore / Todo persistence
  -> Todo Runtime Tool
  -> Todo Continuation State
  -> Session projection / history restore
```

重点是让 Greenfield Todo Tool 与本轮 `CodingAgentTodoContinuationSource` 共享同一个状态和持久化
边界，禁止创建两份 TodoStore。完成后再接 Ecosystem Hook Runtime 的真实宿主组合。
