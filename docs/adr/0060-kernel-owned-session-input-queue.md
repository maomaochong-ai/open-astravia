# 会话输入队列收归 Kernel：Desktop 排队/steer 走同一条主进程队列

Desktop 的「streaming 中发送」此前完全由 renderer 自建：`useSessionManager.sendMessage` 在 `isStreamingAtom` 为 true 时把组装好的 `PromptRequest` 压进渲染进程纯内存队列（`message-queue-atoms.ts`），由 `useMessageQueueDispatcher` 监听 `running-changed(reason === "agent_end")` 弹队首重新 `session.prompt`。而 kernel 里早已存在的 `SessionInputQueue`（steer / followUp 双队列、turn 内消费）对 Desktop 不可达——`RuntimeHost.prompt` 在 `isStreaming` 时无条件抛 `SESSION_BUSY`，从不检查 `request.streamingBehavior`（`runtime-host.ts:681`）。

两套队列并存造成了一批真实缺陷：

- 渲染端队列出队后 `prompt` 失败不回滚、`sendQueuedNow` 先移除再 abort 带 8 秒超时兜底，两处都会**丢用户已看到过的消息**；
- `turn.failed` 只产生 `error` observation + `agent_end`，`attachInFlightBuffer` 的 `terminalReason` 不认 `error` 事件，`running-changed.reason` 落成 `"agent_end"`——上游报错后渲染端把失败当自然结束，**自动把下一条排队消息发出去**；
- 队列纯内存零持久化，崩溃/重启静默丢失；`getState().pendingMessageCount` 恒为 0，主进程对排队一无所知；
- abort/error 后队列静默滞留，无提示无出口；插件（如 vetta-ui-design 模板卡）经 `sendPrompt` 排进去的消息从此杳无音信，而卡片 UI 已显示「已选择」；
- prompt 前置失败（hook 阻断、模型未配置等）时用户消息既不进 jsonl 也不进队列，历史里查无此人。

## 决策

1. **队列唯一属主是 kernel 的 `SessionInputQueue`，渲染进程只保留只读镜像。** renderer 在 streaming 中发送时改为直接 `session.prompt`，请求携带 `streamingBehavior: "followUp"`；`RuntimeHost.prompt` 的 busy 检查放行带 `streamingBehavior` 的请求，转发给已经支持排队的 `RuntimeSession.prompt` → `AgentSession.send`。渲染端的 `messageQueueBySessionAtom` 降级为 kernel 队列的事件镜像，`useMessageQueueDispatcher` 的「渲染端自动出队重发」路径整体删除——followUp 由 agent loop 在自然停止点于**同一 turn 内**消费，消费时经 `message.appended` 落盘并回流 UI，天然消灭「出队后 prompt 失败」「跨轮重拉串台」两类竞态。
2. **队列条目获得身份与可管理性。** `SessionInputQueue` 条目带 `id`，新增 `list` / `remove` / `reorder` / `promoteToSteering`；`RuntimeSessionQueueController` 端口、`RuntimeHost` 与 IPC（`vetta:session:queue-*`）逐层暴露，并新增 `queue-changed` 广播。队列抽屉的「立即发送」保持**打断并立刻发送**的产品语义，但打断与续发下沉到 kernel 内原子完成（take 条目 → cancel 当前 turn → 以该条目开新 turn）；渲染端不再等待 running-changed，原先「先移除、8 秒超时后照发撞 SESSION_BUSY」的丢消息竞态从根上消失。
3. **终止即暂停（pause-on-terminal）。** turn 以 aborted / failed 收尾时，kernel 将队列置为 `paused`：take* 返回空，残留条目不会在下一个不相干的 turn 里突然插入。UI 显示「N 条待发」与「继续发送」入口；`resumeQueue` 解除暂停并（空闲时）以队首开启新 turn，其余条目由该 turn 的自然停止点逐条接力消费。`running-changed` 的 reason 修正为：`turn.failed` 路径的 `error` observation 也置 `terminalReason = "error"`，错误不再伪装成 `agent_end`。
4. **队列持久化为会话 sidecar 文件。** 队列每次变更把可序列化快照（条目 id、behavior、`SessionInput`）写入 `<sessionPath>.queue.json`，resume 会话时装载并恢复 `paused` 状态。app 重启后用户仍能看到并处置排队中的消息。
5. **prompt 前置失败落盘为 custom entry。** `RuntimeSession.prompt` 的 intercept/prepare 抛错与 `RuntimeHost.prompt` 的同步校验失败，除合成 `error` 事件外，追加 `custom` 记录（`prompt_rejected`：原文 + 失败原因）进会话文件，历史可查。失败 turn 后用户重发同文本时，renderer 走 `replaceLastUserMessage` 路径避免 jsonl 双份 user 记录。
6. **插件 `sendPrompt` 语义显式化。** 返回 `{ status: "sent" | "queued", queueItemId? }`；排队时立即 resolve 并附条目 id。插件发送路径不再消费用户挂在输入框上的 `promptAttachment`、不再清输入预测。`conversation.on` 新增 `queue_changed` 事件，卡片类 UI（vetta-ui-design 模板卡）据此呈现「已排队」并在条目被移除/队列暂停时解锁重选。

## 备选方案

- **保留渲染端队列、只修丢失点**：改动最小，但两套队列语义分裂（`pendingMessageCount` 恒 0、SDK 与 Desktop 行为不一致）与零持久化无解，等于在错误的属主上继续加固。
- **followUp 出队时开启新 turn（维持旧观感）**：需要主进程再造一个「turn 结束后调度器」，重新引入出队-失败-回滚问题；turn 内接力消费是 kernel 既有语义，直接复用。
- **队列持久化写进会话 jsonl 本体**：污染对话事实流（未发送的消息不是历史），恢复逻辑要区分「已说」与「想说」；sidecar 文件隔离干净，丢失也只影响队列不损害历史。

## 后果

- `RuntimeHost.prompt` 返回值从 `void` 变为发送结果（`started` / `queued` / `handled`），`turnControl.prompt` 端口同步放宽；既有调用方忽略返回值不受影响。
- `context.queueing === true` 的 prepare 分支（hook/attachment/plugin 上下文降级拼进正文文本）此前在 Desktop 是死代码，现在被真实命中。本 ADR 维持该行为不变（上下文仍能抵达模型，只是以正文形式）；将 contextRecords 随队列条目投递属后续优化。
- 渲染端 `queuedDispatchSeq` / 乐观气泡对账机制中与「跨轮出队」相关的部分随调度器删除而简化；排队消息不再有乐观气泡，其上屏时机 = 被 turn 消费时的 `message.appended` 回流，顺序与模型可见顺序严格一致。
- 打断（abort）语义不变：仍只中止当前 turn；配合 pause-on-terminal，打断后队列可见、可清、可续，不再有静默行为。
- SDK/RPC 宿主原有 steer/followUp 行为不变；它们与 Desktop 从此走同一条队列，`pendingMessageCount` 恢复真实含义。
