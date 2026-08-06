# assistant 错误延迟发射：重试尘埃落定前不往消息流里发 error

一次 429 会在对话页刷出 6~7 个内容一模一样的红色错误块。链路是：coding-agent 的 `RetryController` 默认重试 3 次，每一次失败都产生一条 `stopReason === "error"` 的 assistant message，`session-events.ts` 逐条翻译成宿主 `error` 事件；`auto_retry_start` 当时也被翻译成 `error` 事件（各再加一条）；renderer 的 `useSessionManager` 收到 `error` 就无条件 `appendError` 追加一个块。用户看到的不是「系统在替我重试」，而是一屏事故。

难点在时序：coding-agent 要到 `agent_end` 才调用 `isRetryableError` / `handleRetryableError`（见 `event-router.ts`），而错误在更早的 `message_end` 就已产生。翻译 `message_end` 的那一刻，无从知道后面会不会有重试。

## 决策

1. **延迟发射，不在 `message_end` 当场发 error。** `mapAgentSessionEvent` 把失败挂进 `MapAgentEventState.pendingError`（每会话至多一条）。挂起项只有三个去向：被 `auto_retry_end(success)` 或后续成功的 `message_end` 清掉、被 `aborted` 清掉、或由 `flushPendingError()` 兑现成唯一一条 `error` 事件。
2. **flush 点是 `RuntimeHost.prompt()` / `continue()` 的 `finally`。** `session.prompt()` 内部 `await retry.waitForRetry()`（`input-pipeline.ts`），所以它 resolve 时重试必然已经结束。放在 `finally` 而非成功分支，是为了让 abort 与 throw 路径同样兑现——**挂起而不 flush 是这个机制唯一的失败模式，等于静默吞错**。
3. **不在 coding-agent 侧加 `turn_failed` 终态事件。** 语义上更干净，但要改 coding-agent 的事件协议（`session/types.ts`），影响 im-gateway、cli-app 等所有消费者；而延迟发射把改动圈在 runtime-core 一个文件里。
4. **`auto_retry_start/end` 翻译成专用的 `retry.start` / `retry.end`**，不再复用 `error`。`retry.end` 此前根本没有翻译分支，UI 因此无从得知重试结束。`error` 事件新增 `retryAttempts`，让 UI 能说「已自动重试 3 次仍失败」。
5. **历史回放另走一条路。** 会话文件保留了每一次失败的 assistant message（`retry-controller` 有意为之：keep in session for history），延迟发射管不到。desktop-app 的 `fullHistoryToChat` / `historyToChat` 在回放时折叠连续同类错误并计数。判定「同类」用 `classifyChatError`，与错误卡的分类同源。

## 后果

- `SessionEvent` 联合类型新增 `RetryStartEvent` / `RetryEndEvent`。IPC 转发是全量透传、pet 的 `EVENT_TYPE_INTENTS` 是 `Partial<Record<…>>`，故新增类型不破坏现有订阅方；plugin-host-bridge 的 `translate()` 默认忽略未知类型。
- app-monitor 记录的 `error` 事件数会下降——重试中间态不再上报，这正是意图。
- 任何绕过 `RuntimeHost.prompt()` / `continue()` 直接驱动 agent 的新路径，必须自己调用 flush，否则错误永久丢失。
- `classifyChatError` 与 `RetryController` 的两套正则刻意不共享（重试策略与文案分类演进方向不同），靠 `classifyChatError.test.ts` 里的一致性断言锁住不漂移。该测试上线时即抓到 `retry-controller` 的一处真实漏网：Node 的 `connect ECONNREFUSED …` 不含 "connection refused" 短语，真正的断网一次都不会重试；已补 errno 分支。
