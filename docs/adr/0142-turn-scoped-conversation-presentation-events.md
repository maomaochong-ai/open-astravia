# ADR-0142：会话展示状态改由带身份的持久化事实驱动

## 状态

已接受（补充 ADR-0060 的 Renderer 投影合同）

## 背景

Kernel 已经以 `turnId` 持久化 `turn.started`、`message.appended` 与 Turn 终态，但 RuntimeHost 只把部分 assistant observation 转成公开 `SessionEvent`：用户消息不回流，legacy lifecycle 也没有 Turn 身份。Desktop 因而只能从 `queue.changed` 中某个条目“消失”推断消息已消费，再用模块级 draft、文本与序号猜测它属于哪一轮。

这形成了多个并行事实源：Kernel Turn、队列快照、Renderer streaming 布尔值、全局 draft、乐观消息缓存和异步全量历史。点击“立即发送”时，旧 Turn 的取消、新 Turn 的开始、队列快照和历史回流会交错；任何局部时序调整都只能修复一种排列，并可能让另一个排列出现两个 streaming 回复、旧终态关闭新回复或历史覆盖新消息。openvetta/open-vetta#69 是该结构问题的再次暴露。

## 决策

1. RuntimeHost 从 Kernel 的持久化事实发布身份完整的事件：`conversation.turn.started/completed/cancelled/failed` 必须携带 `turnId`，`conversation.message.appended` 必须携带 `turnId`、`messageId` 与消息内容。旧 `session.lifecycle` 等事件暂时保留为兼容信号，但身份事件可用时不得再用旧事件改变 Turn 状态。
2. `PromptRequest`、`SessionInputRequest` 与 `SessionInput` 接受宿主分配的可选 `messageId`。该 ID 穿过排队与 admission，写入 `message.appended`，但不替代 Conversation Document 的 `event-N` 节点 ID；展示身份与文档分支坐标保持正交。历史记录没有该字段时继续按既有身份读取，不做迁移。
3. Renderer 的 assistant 投影以 `turnId + segment` 为键。Turn 内每个已提交 user message 开启一个新 segment；流事件、错误和终态只能更新同一 Turn 的目标消息。旧 Turn 的迟到终态不得通过“最后一条 assistant”影响新 Turn。
4. `queue.changed` 只投影队列当前快照，不再代表消息消费。排队消息何时上屏，只由 `conversation.message.appended` 决定；“立即发送”不再设置 `sendNowIds`、派发序号或预先中止 UI 草稿。
5. 全量历史只补充持久化元数据。若历史回流时新 Turn 已开始，按稳定消息 ID 合并已存在项，并保留尚未进入该历史快照的 live 项；禁止用旧 Turn 的整表快照覆盖新 Turn。

## 备选方案

- 继续在 `queue.changed` 差分上补 send-now 标记、超时和序号：改动较小，但队列快照仍被赋予它不拥有的消息/Turn 语义，每增加一种交错顺序都需要新补丁。
- 只给 legacy lifecycle 增加可选 `turnId`：能修复一部分终态串台，但用户消息仍靠队列消失与文本对账，历史竞态和重复事实源保留。
- 每次事件后整表重拉历史：实现直接，但高频 I/O、流式块丢失与落后快照覆盖问题更严重。

## 后果

- 同一会话仍由 Kernel 保证单活 Turn；Renderer 即使收到交错或迟到事件，也能独立证明只有目标 Turn 被终止。
- 排队、空闲直发和“立即发送”共享同一消息提交路径，附件等 UI 元数据可由同 ID 的乐观消息保留，不再按文本猜测。
- 持久化格式是向后兼容的加字段：历史记录允许缺少 `messageId`，新写入记录提供稳定身份。旧宿主仍可消费 legacy 事件；新 Renderer 对未提供身份事件的外部 Runtime 保留 legacy fallback。
- 测试重点从固定事件脚本转为身份不变量：旧 Turn 终态不能结束新 Turn、队列快照不能创建消息、历史回流不能删除更新的 live Turn。
