# ADR-0127：等待中的 Prompt 由 Runtime Turn Admission 统一仲裁

## 状态

已接受

## 背景

Agent Team 在启动成员回合前，会把共享上下文 checkpoint 写入成员 Conversation，再发送 prompt。两步分别调用 Runtime 的 `deliverSessionContext(..., "record")` 与 `prompt()`，而两者都要求 Session 空闲。任务取消采用有界等待：业务任务可以已经进入终态，但一个不及时响应 `AbortSignal` 的旧 Turn 仍可能处于 `cancelling`。此时 Team 的成员队列已经释放，下一条“继续”会在共享上下文写入阶段得到 `session_busy`，形成 Team 状态和 Runtime 执行状态之间的竞态（openvetta/open-vetta#29）。

Team 的成员调度器只能串行化 Team work item，不能证明同一 Runtime Session 没有取消清理、后台入口或宿主操作。由 Team 读取 `isStreaming` 后重试仍是“先检查、后执行”，无法消除竞态。

## 决策

1. `PromptRequest` 增加产品无关的 `context` 字段。Prompt adapter 在 Turn admission 后把这些记录与用户消息组装为同一个 `SessionInput`；context、message 与 turn start 使用同一批持久化事件提交。产品层不再为同一 prompt 预先调用独立的 `recordContext`。
2. Runtime 增加 `promptWhenAvailable(sessionId, request, signal)`。Kernel `AgentSession` 是唯一 admission 仲裁者：Session 忙碌或正在取消时，调用方等待真实 `activeTurn` 释放；释放后的状态复查与新 Turn 启动之间不再有 `await`。这不是普通 follow-up 队列：调用会一直等待自己对应的 Turn 完成，因而保留 Team attempt 与 Runtime Turn 的一一对应关系。
3. 等待期间取消只拒绝尚未 admission 的请求，不中止前一个不归它所有的 Turn；完成 admission 后，同一个 `AbortSignal` 才取得新 Turn 的取消所有权。
4. Team 仍在 admission 前持久化共享 checkpoint receipt 和成员引用，因为 Coding Agent 在 snapshot binding 阶段需要据此构造 pinned model context。成员 Conversation 中的 checkpoint reference 改为随 prompt 提交；是否需要补写引用以 Conversation 中的持久化事实判断，避免在“Team 状态已更新、prompt 尚未 admission”时永久漏记。
5. 普通交互 `prompt()` 与现有 `steer` / `followUp` 即时排队语义不变。等待式 admission 是需要把一次产品任务绑定到一次完整 Runtime Turn 的编排入口。

## 备选方案

- **Team 捕获 `session_busy` 后延迟重试**：错误字符串变成调度协议，仍存在检查空闲到再次写入之间的竞态，也会把一次 attempt 拆成多次不透明尝试。
- **共享上下文改用 `nextTurn`，随后照常 prompt**：避免立即报错，但 context 与 prompt 仍是两个独立操作，其他入口可能先消费 context。
- **把 Team prompt 放入现有 follow-up 队列**：队列 API 只返回即时回执，不等待排队 Turn 完成；Team 会过早结算 attempt，取消和结果归属也会丢失。
- **让 Team 成员队列成为 Session 的全局锁**：Runtime 还有普通用户输入、扩展、后台 continuation 与宿主操作等入口，产品层锁无法覆盖，也会反向耦合 Runtime。

## 后果

- Runtime 公共 Prompt 合同新增可选 `context`，`RuntimeHost` 新增等待式 admission；不传新字段和不调用新方法的消费者行为不变。
- Agent Team 不再用独立 context write 抢占 Session，取消后立刻发送“继续”会等待旧 Turn 真正结束，不再把瞬时 busy 结算为失败任务。
- 等待式请求不进入可持久化 follow-up 队列；进程退出时仍由 Team 的 durable work item / attempt 恢复，而不是由 Runtime 重放内存中的等待 Promise。
- Runtime 必须用请求自己的信号区分“等待取消”和“已 admission Turn 取消”，后续新增等待式入口不得恢复成对当前 active Turn 的无条件 `abort()`。
