# Changelog

## [Unreleased]

### Changed

- **Vitest 依赖上收到 monorepo 根**：本包不再声明 `devDependencies.vitest`，改用根目录统一版本；包内仍保留 `vitest.config.ts` 与 `"test": "vitest --run"`。
- `AgentTool` 新增第三个泛型参数 `TScenario extends string = string`，`scope_use` 由 `string[]` 改为 `readonly TScenario[]`。向后兼容（默认 `string`，旧的 `AgentTool<P>` / `AgentTool<P, D>` 不受影响）；上层消费者可绑定具体的场景联合（如 coding-agent 的 `ConversationScenario`）以在声明 `scope_use` 时获得补全/拼写校验。agent-core 自身仍不绑定任何场景词汇、不解读该字段。

### Fixed

- **修复模型把工具调用参数写成正文时该调用彻底丢失**：`AgentLoopConfig` / `AgentOptions` 新增可选 `salvageTextToolCalls`（工具名白名单）。gpt-5.x 一类模型在同一轮里既要叙述又要干活时，会把叙述型工具的参数当成 tool call 前的 preamble 正文吐出来，真正的调用只留给另一个工具——抓包确认参数是逐 token 从 `delta.content` 出来的，流里根本没有对应 `tool_calls`，不是协议解析问题。命中白名单、且参数键唯一匹配某个工具 schema 时，loop 在 `message_end` 前把这段正文还原成 toolCall（`stopReason` 为 `stop` 时一并提为 `toolUse`）。未配置时行为不变。

- **修复运行中新增的工具/系统提示词要等下一次 `prompt()` 才生效**：`agentLoop` 会复制传入的 `AgentContext`，因此整轮多次 LLM 请求一直复用 loop 启动时的 `tools` / `systemPrompt` 快照，运行中调用 `setTools()` / `setSystemPrompt()` 对本轮无效。典型症状：`tool_search` 报告"已激活"某个 MCP 工具，但模型本轮始终拿不到它的 schema，只能反复检索同一个工具直到耗尽。`AgentLoopConfig` 新增可选 `getTools` / `getSystemPrompt`，loop 每轮开始时重新读取（未传则维持旧的快照行为）；`Agent` 默认接到自身 state 上。
- 修复 `tracing.detail="agent"` 且 `tracing.captureContent=true` 时 root `agent.run` 仍只上报摘要，导致 Langfuse trace input/output 看不到用户消息、最终 assistant 输出、system prompt 与工具定义正文。
- 修复 `proxy.ts` 的 `streamProxy` 在 abort listener 上未传 `{ once: true }`：abort 触发后 listener 仍残留到 finally 才被移除，并发 finally 路径异常下可能漏清理。补齐 `{ once: true }` 作为防御。
- 主进程长跑时主流 `AbortSignal` 因外部库累积 abort listener 触发 `MaxListenersExceededWarning`（10 默认上限被多 turn / 多重试场景秒爆）：在 `Agent._runLoop` 创建 per-prompt `AbortController` 时调用 `events.setMaxListeners(0, signal)` 关闭单 signal 的告警阈值。Node 环境通过条件动态加载 `node:events`，浏览器 (web-ui) 自动跳过。配合 `@vetta/ai` 中三处 sleep 的成对 listener 清理，彻底解决 listener 泄漏告警与潜在 GC 压力。

### Added

- **可选模型调用上下文检查点**：`AgentLoopConfig.contextCheckpoints` 默认关闭；启用后，Agent Loop 在模型调用前、assistant 自然结果和 assistant error 后发出请求—应答事件并等待宿主完成，支持持久压缩后替换内部上下文、一次错误恢复及恢复前 steering 注入，不改变普通 Agent 调用路径。
- 新增 `AgentToolExecutionError`：工具适配层可以向 `ToolResultMessage.details` 传递稳定错误码、可重试标记和结构化元数据，不再只能依赖错误文本判断运行时能力变化。
- **模型调用级动态上下文**：`AgentLoopConfig.resolveCallContext` 在每次 LLM 调用前刷新 system prompt 与 tools；同一 Agent Loop 的后续模型调用可以看到受控的运行时能力变化。
- 将 Agent 自然停止点的自动续跑钩子明确为异步 `continuationProvider`，底层 `AgentLoopConfig` 对应改为 `getContinuationMessages`；普通 `followUp()` 消息队列语义保持不变。
- 新增平台无关 tracing 接入点：`AgentOptions` / `AgentLoopConfig` 可传入 `RuntimeTracer`，agent loop 会把 agent run、LLM generation、tool call 映射为 observation，并上报 token usage、cost、错误与工具耗时；正文捕获由 `tracing.captureContent` 显式控制。
- 完善 tracing payload：LLM generation input 记录 system prompt、消息和工具定义结构，tool observation 记录工具描述/schema 与调用参数结构；root agent observation 改为运行摘要，避免和 generation 输入/输出重复。
- 新增 `tracing.detail`：默认 `agent` 只发送每次 run 的 root observation，并在 root output 聚合 LLM/tool 次数、token usage 与 cost，减少 Langfuse observation 列表噪音；设为 `standard` 时继续发送 agent/LLM/tool observations。
- **`AgentTool.execute` 新增第五个可选参数 `ctx: ToolExecutionContext`，工具可上报阶段计时**：`ctx.phase(label)` 表示「从此刻起开始做 label 这一段」，下一次 `ctx.phase` 调用（或 tool_execution_end）隐含上一段结束。每次调用 push 一条 `tool_execution_phase` AgentEvent（含 `toolCallId / toolName / label / atMs`，`atMs` 是相对 startedAt 的偏移）。`tool_execution_start` 事件加 `startedAt`、`tool_execution_end` 加 `startedAt / durationMs / phases`。导出新类型 `ToolPhase` 与 `ToolExecutionContext`。旧工具不传 `ctx` 仍正常工作——`phases` 为空数组、startedAt/durationMs 仍由 agent-loop 计算并上报。设计意图：让上层（coding-agent / desktop-app）能持久化并 UI 展示工具内部分段耗时，同时通过把数据放在事件而非 result.content 里、由调用方决定如何存——保证 timing 不混进 LLM 上下文。

## [0.55.2] - 2026-03-06

## [0.55.1] - 2026-02-26

## [0.55.0] - 2026-02-24

## [0.54.2] - 2026-02-23

## [0.54.1] - 2026-02-22

## [0.54.0] - 2026-02-19

## [0.53.1] - 2026-02-19

## [0.53.0] - 2026-02-17

## [0.52.12] - 2026-02-13

### Added

- Added `transport` to `AgentOptions` and `AgentLoopConfig` forwarding, allowing stream transport preference (`"sse"`, `"websocket"`, `"auto"`) to flow into provider calls.

## [0.52.11] - 2026-02-13

## [0.52.10] - 2026-02-12

## [0.52.9] - 2026-02-08

## [0.52.8] - 2026-02-07

## [0.52.7] - 2026-02-06

### Fixed

- Fixed `continue()` to resume queued steering/follow-up messages when context currently ends in an assistant message, and preserved one-at-a-time steering ordering during assistant-tail resumes ([#1312](https://github.com/badlogic/pi-mono/pull/1312) by [@ferologics](https://github.com/ferologics))

## [0.52.6] - 2026-02-05

## [0.52.5] - 2026-02-05

## [0.52.4] - 2026-02-05

## [0.52.3] - 2026-02-05

## [0.52.2] - 2026-02-05

## [0.52.1] - 2026-02-05

## [0.52.0] - 2026-02-05

## [0.51.6] - 2026-02-04

## [0.51.5] - 2026-02-04

## [0.51.4] - 2026-02-03

## [0.51.3] - 2026-02-03

## [0.51.2] - 2026-02-03

## [0.51.1] - 2026-02-02

## [0.51.0] - 2026-02-01

## [0.50.9] - 2026-02-01

## [0.50.8] - 2026-02-01

### Added

- Added `maxRetryDelayMs` option to `AgentOptions` to cap server-requested retry delays. Passed through to the underlying stream function. ([#1123](https://github.com/badlogic/pi-mono/issues/1123))

## [0.50.7] - 2026-01-31

## [0.50.6] - 2026-01-30

## [0.50.5] - 2026-01-30

## [0.50.3] - 2026-01-29

## [0.50.2] - 2026-01-29

## [0.50.1] - 2026-01-26

## [0.50.0] - 2026-01-26

## [0.49.3] - 2026-01-22

## [0.49.2] - 2026-01-19

## [0.49.1] - 2026-01-18

## [0.49.0] - 2026-01-17

## [0.48.0] - 2026-01-16

## [0.47.0] - 2026-01-16

## [0.46.0] - 2026-01-15

## [0.45.7] - 2026-01-13

## [0.45.6] - 2026-01-13

## [0.45.5] - 2026-01-13

## [0.45.4] - 2026-01-13

## [0.45.3] - 2026-01-13

## [0.45.2] - 2026-01-13

## [0.45.1] - 2026-01-13

## [0.45.0] - 2026-01-13

## [0.44.0] - 2026-01-12

## [0.43.0] - 2026-01-11

## [0.42.5] - 2026-01-11

## [0.42.4] - 2026-01-10

## [0.42.3] - 2026-01-10

## [0.42.2] - 2026-01-10

## [0.42.1] - 2026-01-09

## [0.42.0] - 2026-01-09

## [0.41.0] - 2026-01-09

## [0.40.1] - 2026-01-09

## [0.40.0] - 2026-01-08

## [0.39.1] - 2026-01-08

## [0.39.0] - 2026-01-08

## [0.38.0] - 2026-01-08

### Added

- `thinkingBudgets` option on `Agent` and `AgentOptions` to customize token budgets per thinking level ([#529](https://github.com/badlogic/pi-mono/pull/529) by [@melihmucuk](https://github.com/melihmucuk))

## [0.37.8] - 2026-01-07

## [0.37.7] - 2026-01-07

## [0.37.6] - 2026-01-06

## [0.37.5] - 2026-01-06

## [0.37.4] - 2026-01-06

## [0.37.3] - 2026-01-06

### Added

- `sessionId` option on `Agent` to forward session identifiers to LLM providers for session-based caching.

## [0.37.2] - 2026-01-05

## [0.37.1] - 2026-01-05

## [0.37.0] - 2026-01-05

### Fixed

- `minimal` thinking level now maps to `minimal` reasoning effort instead of being treated as `low`.

## [0.36.0] - 2026-01-05

## [0.35.0] - 2026-01-05

## [0.34.2] - 2026-01-04

## [0.34.1] - 2026-01-04

## [0.34.0] - 2026-01-04

## [0.33.0] - 2026-01-04

## [0.32.3] - 2026-01-03

## [0.32.2] - 2026-01-03

## [0.32.1] - 2026-01-03

## [0.32.0] - 2026-01-03

### Breaking Changes

- **Queue API replaced with steer/followUp**: The `queueMessage()` method has been split into two methods with different delivery semantics ([#403](https://github.com/badlogic/pi-mono/issues/403)):
  - `steer(msg)`: Interrupts the agent mid-run. Delivered after current tool execution, skips remaining tools.
  - `followUp(msg)`: Waits until the agent finishes. Delivered only when there are no more tool calls or steering messages.
- **Queue mode renamed**: `queueMode` option renamed to `steeringMode`. Added new `followUpMode` option. Both control whether messages are delivered one-at-a-time or all at once.
- **AgentLoopConfig callbacks renamed**: `getQueuedMessages` split into `getSteeringMessages` and `getFollowUpMessages`.
- **Agent methods renamed**:
  - `queueMessage()` → `steer()` and `followUp()`
  - `clearMessageQueue()` → `clearSteeringQueue()`, `clearFollowUpQueue()`, `clearAllQueues()`
  - `setQueueMode()`/`getQueueMode()` → `setSteeringMode()`/`getSteeringMode()` and `setFollowUpMode()`/`getFollowUpMode()`

### Fixed

- `prompt()` and `continue()` now throw if called while the agent is already streaming, preventing race conditions and corrupted state. Use `steer()` or `followUp()` to queue messages during streaming, or `await` the previous call.

## [0.31.1] - 2026-01-02

## [0.31.0] - 2026-01-02

### Breaking Changes

- **Transport abstraction removed**: `ProviderTransport`, `AppTransport`, and `AgentTransport` interface have been removed. Use the `streamFn` option directly for custom streaming implementations.

- **Agent options renamed**:
  - `transport` → removed (use `streamFn` instead)
  - `messageTransformer` → `convertToLlm`
  - `preprocessor` → `transformContext`

- **`AppMessage` renamed to `AgentMessage`**: All references to `AppMessage` have been renamed to `AgentMessage` for consistency.

- **`CustomMessages` renamed to `CustomAgentMessages`**: The declaration merging interface has been renamed.

- **`UserMessageWithAttachments` and `Attachment` types removed**: Attachment handling is now the responsibility of the `convertToLlm` function.

- **Agent loop moved from `@vetta/ai`**: The `agentLoop`, `agentLoopContinue`, and related types have moved to this package. Import from `@vetta/agent-core` instead.

### Added

- `streamFn` option on `Agent` for custom stream implementations. Default uses `streamSimple` from pi-ai.

- `streamProxy()` utility function for browser apps that need to proxy LLM calls through a backend server. Replaces the removed `AppTransport`.

- `getApiKey` option for dynamic API key resolution (useful for expiring OAuth tokens like GitHub Copilot).

- `agentLoop()` and `agentLoopContinue()` low-level functions for running the agent loop without the `Agent` class wrapper.

- New exported types: `AgentLoopConfig`, `AgentContext`, `AgentTool`, `AgentToolResult`, `AgentToolUpdateCallback`, `StreamFn`.

### Changed

- `Agent` constructor now has all options optional (empty options use defaults).

- `queueMessage()` is now synchronous (no longer returns a Promise).
