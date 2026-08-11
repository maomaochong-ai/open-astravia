# `packages/agent` 专项审计

## 总体判断

`packages/agent` 不是 Vercel `ToolLoopAgent` 的简化劣化版。它实际上同时承担两层职责：

1. 一次 Agent run 的模型/工具循环。
2. 桌面会话控制器，包括可变状态、订阅、steering、follow-up、动态工具和继续执行。

第二层是 Vetta 产品需要的，也是该包最有价值的部分。问题在于两层共享同一套可变对象和事件流终止机制，导致底层异常、宿主握手和 UI 状态互相影响。

## 做得好的部分

### 面向长任务的交互能力

[`AgentMessageQueue`](../../packages/agent/src/runtime/message-queue.ts) 将 steering 与 follow-up 分开，并支持一次取一个或全部取出。工具执行后检查 steering，可以在不强制中止当前工具的情况下跳过后续调用，语义适合桌面 Agent。

### 自定义消息与 LLM 边界分离

`AgentMessage` 支持声明合并，`convertToLlm` 在模型调用边界过滤 UI-only 消息。这比强迫所有宿主消息都进入 Provider 协议更合理。

### 动态调用上下文

`resolveCallContext`、`getTools` 和 `getSystemPrompt` 允许工具在运行中改变后续步骤可见能力。对需要动态激活工具的 coding agent，这是实际需求。

### 事件粒度适合 UI

消息、turn、工具开始/更新/阶段/结束事件足够驱动进度 UI，工具 phase 和 telemetry 也比最小工具循环更完善。

## 问题清单

### AG-01：后台 loop 抛错后事件流不会结束（P0）

证据：[`agent-loop.ts`](../../packages/agent/src/agent-loop.ts#L34)

`agentLoop()` 和 `agentLoopContinue()` 用未 await、未 catch 的异步 IIFE 启动 `runLoop()`。`runLoop()` 对普通异常记录 telemetry 后重新抛出，但外层没有调用 `stream.end()` 或失败方法。

调用链因此是：

```text
transformContext / convertToLlm / streamFn 抛错
  -> runLoop 重新抛出
  -> 后台 Promise rejected
  -> Agent 的 for await 仍等待下一个事件
  -> prompt() / waitForIdle() 不完成
```

本次已用一次性 Bun 脚本令 `transformContext` 抛错，150ms 后消费结果为 `timeout`，确认该路径会悬挂。

建议：不要用裸 IIFE。创建受控 run task，并在唯一出口执行 `stream.fail(error)`。`Agent._runLoop()` 应直接 await 该 task 或消费一个能拒绝的 AsyncIterable。

### AG-02：没有默认循环上限和统一停止策略（P1）

证据：[`agent-loop.ts`](../../packages/agent/src/agent-loop.ts#L129)

外层是 `while (true)`，只要模型持续返回 tool call、checkpoint 持续请求 retry，或 continuation provider 持续返回消息，就可以无限运行。取消信号不是资源预算。

对照仓库 `ToolLoopAgent` 默认 `isStepCount(20)`，也允许组合自定义 stop conditions。

建议：至少提供：

- 默认 `maxSteps`，建议 20，可由产品配置。
- `maxToolCalls`、`maxDurationMs` 和 `maxRecoveryAttempts`。
- 可组合 `stopWhen(runSnapshot)`，并在终止事件中给出结构化原因。

### AG-03：上下文检查点可能永久等待（P1）

证据：[`context-checkpoint.ts`](../../packages/agent/src/loop/context-checkpoint.ts#L11)

检查点通过事件把 `complete()` / `fail()` 回调交给宿主，然后返回一个 Promise。若没有订阅者、订阅者抛错或忘记响应，Promise 永远不结束；`AbortSignal` 也不能解除等待。

建议：

- 开启检查点时验证至少有 handler，而不只是事件订阅者。
- 请求接受 `AbortSignal` 和 timeout。
- 超时产生明确的 `ContextCheckpointTimeoutError`。
- 更理想的 API 是配置 `contextCheckpoint(request) => Promise<Result>`，事件只做旁路观察，不承担控制流 RPC。

### AG-04：基础设施失败、模型失败和消息历史混在一起（P1）

证据：[`agent.ts`](../../packages/agent/src/agent.ts#L514)

上层捕获任意异常后构造一个 usage 全为 0 的 assistant message，并写入会话历史。这样会把以下完全不同的情况压成相同形态：

- Provider 正常返回模型错误。
- `transformContext` 代码缺陷。
- 事件订阅者抛错。
- telemetry 或 checkpoint 集成错误。
- 用户取消。

合成消息会污染后续上下文，也让重试策略只能解析字符串。

建议：run 结果分为 `completed`、`cancelled`、`failed`；只有确实来自模型协议、并且适合回放给模型的错误才进入消息历史。基础设施错误保留结构化 cause，交给宿主决定是否展示或持久化。

### AG-05：订阅者可以中止核心运行（P1）

证据：[`agent.ts`](../../packages/agent/src/agent.ts#L549)

`emit()` 同步逐个调用 listener，没有隔离。任意 UI listener 抛错会跳出事件消费循环，随后被转换成 assistant error message。观察者不应改变被观察任务的控制流。

建议：单独捕获 listener 异常并上报 host error channel；或者使用明确的同步事件总线合同，禁止错误回流到 Agent run。

### AG-06：工具执行缺少超时，执行策略不可配置（P1）

证据：[`tool-execution.ts`](../../packages/agent/src/loop/tool-execution.ts#L22)

当前工具严格串行，这有利于每个工具后检查 steering，也能避免未知副作用工具并发，因此不能简单判定为错误。但目前没有：

- 单工具 timeout。
- 总工具阶段 timeout。
- 工具审批/人工确认合同。
- 幂等或副作用元数据。
- 可选并发策略。

其中缺少 timeout 是可能导致任务永久等待的 P1 问题；审批、元数据和可选并发是 P2 能力缺口。建议保留串行默认值，为明确标记 `readOnly` / `parallelSafe` 的工具提供受限并发；工具 timeout 应先于并发实现。

### AG-07：工具类型在事件边界退化为 `any`（P2）

证据：[`types.ts`](../../packages/agent/src/types.ts#L302)

`AgentTool` 自身能从 TypeBox 推导参数，但 `AgentState.tools`、`AgentEvent` 的 args/result/partialResult 和多个配置点又回到 `any`。上层 UI 无法安全区分工具输入和结果。

建议：Agent 泛型接受 `ToolSet` 映射，由 tool name 判别 event；动态工具场景可退化为 `unknown`，而不是 `any`。

### AG-08：代理流协议是另一套手写实现（P1）

证据：[`proxy.ts`](../../packages/agent/src/proxy.ts#L85)

代理层自行解析 SSE、直接 `JSON.parse`、重建 partial，并使用同一个不完整的 `EventStream`。如果 HTTP body 正常关闭但没有收到 terminal event，代码调用 `stream.end()`，最终 `result()` 永远 pending。

协议还没有版本号、runtime schema、未知事件兼容策略或 request/response metadata。客户端与服务端独立升级时风险较高。

建议：将代理 wire protocol 放到独立模块，加入版本字段和 schema；复用 `packages/ai` 的标准 SSE/JSON 工具；流结束前必须验证 terminal event，否则 fail。

### AG-09：状态所有权不清晰（P2）

`state` getter 返回内部可变对象；一部分 setter 在运行中通过 hook 生效，另一部分只影响下一次 run。`AgentState` 同时包含配置、持久消息、临时流消息、pending tool calls 和错误。

建议把状态拆成：

- `AgentSessionConfig`
- `ConversationState`
- `AgentRunState`

每次 prompt 创建一个 `AgentRun`，会话对象只负责排队、持久状态与启动/取消 run。这样可以保留当前产品行为，同时缩小并发与生命周期推理范围。

## 与 Vercel Agent 的关键差异

| 能力 | Vetta `Agent` | Vercel `ToolLoopAgent` |
| --- | --- | --- |
| 长期可变会话状态 | 内建 | 不负责 |
| steering / follow-up | 内建 | 无直接等价物 |
| 动态工具和系统提示词 | hook | `prepareStep` / `prepareCall` |
| 默认循环上限 | 无 | 20 steps |
| 工具超时 | 无 | 支持 |
| 工具审批 | 无 | 支持 |
| 工具输入修复 | 文本 salvage 白名单 | `repairToolCall` |
| 工具并发 | 串行 | 多工具并行 |
| 工具类型推导 | 局部，事件中退化 | ToolSet 全链路泛型 |
| 会话检查点 | Vetta 特有 | 无直接等价物 |

结论：不应直接用 `ToolLoopAgent` 替换 `packages/agent`。应该借鉴其 run 级停止策略、类型和工具保障，同时保留 Vetta 的会话控制层。

## 测试评价

本次运行的 agent loop、Agent、state projection 和 message queue 共 27 个测试全部通过，说明正常路径和已有交互语义有稳定基础。

最重要的缺口是失败路径：

- `transformContext` / `convertToLlm` / `streamFn` 同步或异步抛错。
- Provider stream 未产生 terminal event 就关闭。
- checkpoint 无订阅者、超时、abort。
- listener 抛错。
- 无限 tool loop 达到预算。

这些测试应先于结构重构补齐。
