# `packages/agent` 与 Runtime 重构方案

## 1. 首要判断：避免双重 Runtime

现有 `packages/agent` 的 `Agent` 类拥有 messages、streaming state、steering/follow-up 队列和 abort controller；`packages/runtime-core` 又拥有 Session、TurnPipeline、repository、队列、context checkpoint 和状态投影。两者继续各自增长，会产生：

- 两套消息真相。
- 两套取消和并发规则。
- 两套 steering/follow-up 行为。
- Agent event 与 Kernel event 的重复映射。
- 修复只落在其中一条产品路径的风险。

生产运行时必须以 `runtime-core` 为唯一所有者。`packages/agent` 只保留无持久状态的 Turn Engine。

## 2. 目标执行模型

### `runAgentTurn()`

输入是一次不可变运行请求：

```ts
interface AgentTurnRequest {
  readonly messages: readonly Message[];
  readonly resolveModelCall: (context: ModelCallContext) => Promise<ResolvedModelCall>;
  readonly resolveTools: (context: ToolResolutionContext) => Promise<readonly AgentTool[]>;
  readonly checkpoint?: AgentCheckpointHandler;
  readonly limits: AgentRunLimits;
  readonly signal: AbortSignal;
}
```

输出分离“事件”和“最终结果”：

```ts
interface AgentRun {
  readonly events: AsyncIterable<AgentExecutionEvent>;
  readonly result: Promise<AgentRunResult>;
}
```

`result` 必须在成功、失败、abort 和协议错误时恰好 settled 一次。不能沿用“事件流结束但 result 仍 pending”的语义。

### Step 边界

一个 step 定义为一次 Model Call 加上该 AssistantMessage 触发的工具执行。每个 step 固定经过：

```text
resolve frame -> checkpoint -> model stream -> assistant message
-> checkpoint -> validate tool calls -> authorize/execute -> append tool results
-> stop decision
```

状态机必须显式建模，禁止依靠嵌套 async IIFE 的隐式控制流。

### Checkpoint

当前 `context_checkpoint` 事件携带 `complete()`/`fail()`，如果消费者遗漏处理就可能挂起。目标改为请求回调：

```ts
type AgentCheckpointHandler = (
  request: AgentCheckpointRequest,
  signal: AbortSignal,
) => Promise<AgentCheckpointResult | undefined>;
```

Agent Engine 直接 await；Runtime Pipeline 在回调中持久化、压缩或决定 retry。这样 checkpoint 是明确调用栈的一部分，不是伪装成事件的双向 RPC。

## 3. Stop Budget

默认必须有限，至少包括：

- `maxModelCalls`
- `maxToolCalls`
- `maxRecoveryAttempts`
- 可选 `deadlineMs`

终止结果使用结构化 reason：

- `completed`
- `max_model_calls`
- `max_tool_calls`
- `recovery_exhausted`
- `aborted`
- `failed`

默认值由 Runtime Profile 明确给出，Agent Engine 不读取产品设置或环境变量。测试必须证明恶意/异常模型无限返回工具调用时能在有限步骤终止。

## 4. 工具体系

建议将 Runtime Tool 定义改成 schema 泛型：

```ts
interface RuntimeToolDefinition<TSchemaDef extends TSchema = TSchema> {
  readonly name: string;
  readonly inputSchema: TSchemaDef;
  execute(
    input: Static<TSchemaDef>,
    context: RuntimeToolExecutionContext,
  ): Promise<RuntimeToolResult>;
}
```

当前 `Type.Unsafe<Record<string, unknown>>({ ...inputSchema })` 适配会丢失 schema 与 execute 参数之间的类型关联，应在工具定义源头保留泛型，在 Provider 边界只序列化 JSON Schema。

工具执行依次经过：

1. 找到工具定义。
2. TypeBox 校验未知输入。
3. Runtime ToolPolicy 授权。
4. 执行并捕获结构化错误。
5. 将结果规范化为模型可见内容和 Runtime observation。

Agent Engine 不拥有产品授权策略。Standalone 兼容模式可以注入 allow-all policy，但必须显式注入。

## 5. 动态能力

动态 instruction、tools 和 context 在每次 Model Call 前由 `runtime-core` 生成不可变 `ModelCallFrame`。规则：

- 当前调用开始后，配置更新只影响下一次调用。
- 工具执行使用触发该调用的 Frame，不读取下一帧工具集合。
- Frame 有 `callId` 和 `snapshotId`，方便 trace 与差分测试。
- Agent 只消费最终 Frame，不重新编译 skill、MCP 或 Feature。

这能消除 Runtime 与 Agent 各自 resolve prompt/tools 的重复行为。

## 6. 事件边界

Agent Execution Event 只描述执行过程：

- model call start/finish
- content delta
- assistant message ready
- tool validation/start/finish
- run finish

Runtime 将其投影为：

- 持久化事实：message appended、turn completed/failed/cancelled。
- 瞬时 observation：流式 delta、工具进度、usage、trace。

Agent 不生成 sessionId、repository version 或 UI event。Runtime 为事件添加 session/turn identity。

## 7. `Agent` 类的处理

最终建议：

- 保留 `@vetta/agent-core` 包作为无状态执行引擎。
- 将现有 `Agent` 移到 `compat/standalone-agent.ts`，通过 `@vetta/agent-core/standalone` 子路径导出，内部完全基于 `runAgentTurn()`。
- 停止为它新增产品能力。
- 根入口停止导出 `Agent`；旧根导出先标记 deprecated 并保留至少两个锁步发布周期。
- 仓库生产代码不得新增 `new Agent()`。
- 仓库内调用清零、外部消费者核查完成、替代文档和测试齐全后，在 breaking minor 删除 standalone；若确认存在真实外部用户，则将它作为独立薄 wrapper 维护，但不得反向污染 engine 类型。

## 8. Runtime 上游调整

`runtime-core` 需要：

- 用 callback checkpoint 替换双向 `context_checkpoint` 事件。
- 让 `ModelCallFrame` 成为 Agent 每次调用的唯一 prompt/tools 来源。
- 将 Agent limits 放入 Profile/Snapshot。
- 在 TurnPipeline 继续负责 terminal persistence 和 snapshot release。
- 把 `AgentCoreTurnEngine` 重命名为中性名称，例如 `ModelToolTurnEngine`，并减少字段转换。

`coding-agent` 需要停止公开依赖 `AgentCoreTurnEngineOptions`。组合选项应面向 `TurnEnginePort` 或更窄的 `ModelRuntimeOptions`。

## 9. 共享类型迁移

当前 `AgentMessage`、`ThinkingLevel`、`ToolPhase`、`AgentEvent` 使大量上层模块仅为类型依赖 Agent。目标迁移：

| 当前类型 | 目标所有者 | 处理 |
| --- | --- | --- |
| `ThinkingLevel` | `@vetta/ai/protocol` | 与 AI 中现有定义合并为 `ReasoningEffort`，包含 `off` 和 provider extension |
| `AgentMessage` | AI Message + Runtime envelope | Engine 只接收模型 Message；UI/扩展 entry 由 Runtime envelope 承载 |
| `ToolPhase` | `@vetta/runtime-core` | 它是执行 observation，不是 Agent 公共模型协议 |
| `AgentEvent` | Agent execution / Runtime SessionEvent | 内部 step event 留 Agent；SDK/RPC 改用 Runtime SessionEvent |
| `AgentToolResult`/update | Runtime Tool 契约 | 产品工具不再依赖 standalone Agent 类型 |
| `StreamFn` | `@vetta/ai` model runtime | Agent 依赖模型调用端口，不暴露 Provider stream function |

迁移后，`coding-agent` 对 `@vetta/agent-core` 的直接 import 应只出现在 Runtime Engine 组装或专门适配层，不能散落在 compaction、memory、session、RPC 和扩展 public API。

