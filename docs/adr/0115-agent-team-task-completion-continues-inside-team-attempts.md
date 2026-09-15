# ADR-0115：团队任务完成通知在 Team attempt 内续跑

## 状态

已接受

## 背景

成员完成委派任务后，`TeamTurnCoordinator.notifyTaskInitiator` 以 `triggerTurn` 模式把 `agent-team.task-completed.v1` 通知投递给发起者（通常是 leader）的 Runtime。Runtime 用 `requestContinuation` 在当前 turn 结束后自行启动一次续跑。

这次续跑不属于任何 Team attempt：

- `TeamSessionEventHub` 只转发有 active attempt 的 Runtime 事件，续跑的流式输出被直接丢弃；
- `TeamPublicationWorkflow` 只发布 attempt 的结果，续跑产出的回答永远不会进入协调会话；
- 主会话聚合视图只渲染协调会话，于是这部分回答在界面上彻底消失。

平时这个缺陷被掩盖了：leader 的主要回答通常在 `team_wait_tasks` 所在的 attempt 内完成，丢的只是事后一句收尾。一旦 leader 在等待期间遇到 provider 失败（例如流式连接 EOF），attempt 被判为中断，真正的最终汇报全部落在这种续跑里，主会话里就只剩委派卡片，看不到 leader 的任何消息。

## 决策

1. **任务完成通知进入发起者自己的成员通道。** 发起者名下有 Team work item 时，通知先在内存中排队，再经 `TeamMemberScheduler` 调度到该成员的通道里，排在它当前占用通道的 attempt 之后。通道里已经排着一次续跑时，后来的通知并入同一批，与 Runtime `requestContinuation` 的合并语义一致。

2. **续跑本身是一次 `continue` 模式的 Team attempt。** attempt runner 在请求携带 `continuationContext` 时，以 `deliverSessionContext(..., "triggerTurn")` 驱动 Runtime，并等待这次续跑 turn 结束。流式事件、失败分类、partial 发布、最终结果发布都复用普通 attempt 的路径。

3. **续跑归属由 `planTeamInitiatorContinuation` 决定：**
   - 发起者最新的 work item 仍处于 `waiting` / `attention-required`：直接续上这个 work item，回答与被中断的请求合并在同一个 leader 气泡里；
   - 已进入终态：为同一请求新建后续 work item，`requestTurnId` 为 `<原请求>:continuation:<n>`，在时间线上显示为一条新的 leader 消息；
   - 发起者没有 Team work item，或它仍在运行（通道串行下不应出现）：沿用原来的纯 Runtime 续跑。

4. **停止会话会丢弃尚未开始的续跑。** `abort` 清空该会话排队的通知；已入队的调度按停止代次失效，不会在用户停止后复活 leader。

## 备选方案

- **渲染端回退读取 leader 的私有 Runtime 历史。** 违背“协调会话是唯一公开时间线”的约束（见 `teamChatModel.ts` 聚合投影的说明）；重新打开会话时显示内容会随私有历史的形态变化。
- **只发布失败 attempt 的 partial。** 能找回委派卡片之前的内容，但续跑里的最终汇报依旧丢失。它作为独立修复同时落地，不能替代本决策。
- **让 Runtime 的 `prompt` 等待续跑结束。** 需要改变 Runtime Core 的 turn 生命周期合同，影响所有非团队会话，代价与风险都更高。

## 后果

- leader 的续跑回答对主会话可见，失败恢复后的最终汇报会作为 leader 消息发布。
- 任务完成到 leader 续跑之间多了一个调度步骤：leader 通道忙时，通知等当前 attempt 结束才投递，而不是由 Runtime 在 turn 结束后自行启动。两者的先后次序相同。
- 协调会话里会出现 `<原请求>:continuation:<n>` 形式的 work item。它们由 `local-user` 请求派生、`createdByParticipantId` 沿用原 work item，因此不会生成新的委派活动卡片。
- 待投递的通知只保存在内存中，进程退出时丢失。这与原先由 Runtime 内存排队的持久性相同；已完成任务的结果仍然持久保存在协调会话中。
