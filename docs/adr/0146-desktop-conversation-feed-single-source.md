# ADR-0146：Desktop 会话消息流收敛为「快照 + 序号事件 → 纯 Reducer」的单一事实源

## 状态

提议（延续 ADR-0142 的身份事件合同，替换 Renderer 侧的消息列表投影方式）

## 背景

ADR-0142 让 Runtime 发布带 `turnId` / `messageId` 的身份事件，但 Renderer 的消息列表仍保留了它之前的结构：

- **一个全局数组、多路写入**：`chatMessagesAtom` 只存当前会话，由实时事件、乐观用户消息、尾部预览历史（`openViewer tailTurns:2`）、全量历史回填、Turn 结束后的历史刷新五路写入，写入点散落在 7 个文件约 15 处。
- **靠启发式合并**：`patchLiveMessagesWithCanonical` 要求 live 与 canonical 长度、kind 逐项一致，否则整表替换；`reconcileOptimisticUserMessages` 在 id 对不上时退回「用户消息序号 + 文本/附件相等」，并在对账 3 次后丢弃；`preserveMessagesAddedAfterSnapshot` 处理快照期间新增的消息。
- **三套事件协议并存**：身份协议、原始 assistant 通道、legacy（`session.lifecycle` + `message.delta` / `thinking.delta` / `toolcall.start` / `message.final`）。Renderer 用 `identityProtocolRef`、`hasRawAssistantStream()` 在运行时切换分支，legacy 分支依赖模块级 `draftId` 和「末尾是未结束的 agent 消息」猜测归属。
- **Renderer 自己保存 Turn 身份**：`ConversationProjection.turnSegments` 在切会话时重置，切回运行中的会话只能靠 `restoreAssistantTurn` 伪造草稿，靠 `adoptTurn` 从已显示消息的 id 字符串里解析分段号（04ac47b67）。
- **打开会话有事件空窗**：历史读取与 `subscribe` 之间没有序号衔接。Relay 的 in-flight 重放只含当前模型调用的 assistant 事件与 `model.request.started`，不含 `conversation.turn.started`、本轮用户消息与 `tool.*`。
- **模块级可变状态**：`chatStreamOwner`、`openSessionToken`、`currentUnsubscribe`、`draftId`、`idCounter`、`pendingByRuntimeId`、`turnStatsCache` 游离于 store 生命周期之外，靠 `activeSessionRef` 与 `chatStreamOwner` 两道闸门防止串会话。
- **同一视图模型三种生成方式**：普通会话用命令式修改函数（`chat-service.ts`）；Team 用「持久化快照 + 按 messageId 覆盖的 live 流 + sequence」的纯 reducer（`reduceTeamStreamState`）；Viewer / Workflow 用 `useState` + `fullHistoryToChat`。

自 2026-05 起，上述目录累计 28 个 `fix` 提交，几乎都落在以上几类问题上：乐观气泡残留或错删、切会话串流、两条回复同时处理中、回复被拆成两段、Team 与普通会话耗时不一致、长会话滚动跳变。每次修复都是在启发式上再加一个特例。

已核实的事实（作为本决策的前提）：

1. 产品内所有会话都经 `KernelRuntimeSessionBackend`，身份事件总会发出；Kernel 写入的 `message.appended` 总带 `messageId`（宿主提供的，或 `kernelMessageId`）。
2. `message.delta` / `thinking.delta` / `toolcall.start` / `message.final` 在产品路径上已没有发送方，Renderer 中对应分支是死代码。
3. `RuntimeHostSessionEventRelay` 已给每个会话事件分配单调递增的 `sequence`。但 `getFullHistory` / `getState` / `openViewer` 都不带序号水位；running 状态与 in-flight 缓冲仍以 legacy `session.lifecycle` 为准。
4. 带 `turnId` 的历史投影出的 id 与实时流一致：用户消息为 `messageId`，assistant 为 `assistant:<turnId>:<segment>`。

## 决策

1. **单一事实源**：每个会话一份 `ConversationFeedState`，按会话键隔离（`atomFamily`），不再有「当前会话」全局数组：

   ```
   ConversationFeedState {
     watermark        // 已应用的最大 relay sequence
     durable          // 持久化历史投影，只追加前缀（分页）或按 id 更新元数据
     live             // 进行中的 assistant 分段，按 assistant:<turnId>:<segment> 覆盖
     pendingUser      // 乐观用户消息，按宿主分配的 messageId 索引
     turns            // turnId → 当前分段、startedAt；属于状态而非 ref
   }
   ```

   列表 = `selectFeedItems(state)`：`durable` 按 id 被 `live` 覆盖，末尾追加未确认的 `pendingUser`。纯函数，不做形状比较。

2. **所有写入都是 action**：`feed.attached`、`feed.prefixLoaded`、`runtime.event`、`user.optimisticSent`、`user.sendRejected`、`user.truncated`（编辑 / 失败重发 / fork）、`feed.rekeyed`（新会话从临时键迁到 sessionPath）。只有一个 reducer，可离线重放、可做属性测试。

3. **Renderer 只认身份协议**：删除 legacy 事件分支、`identityProtocolRef`、`draftId` / `ensureDraft` / `finalizeMessage` / `appendTextDelta` 等命令式修改函数，Turn 状态只由 `conversation.turn.*` 驱动。

4. **打开会话 = 先订阅，再取带水位的快照**：新增 `session.attach(sessionId)`，返回 `{ tailHistory, olderCursor, activeTurn: { turnId, startedAt, events[] }, watermark }`。Main 在同一同步段内读取 relay 序号与 in-flight 缓冲。Renderer 先订阅并暂存事件，快照到达后丢弃 `sequence ≤ watermark` 的事件。reducer 对 `messageId` 幂等，所以「已落盘但尚未发出」的事件重复到达也无害。Relay 的 in-flight 缓冲扩展到整个活动 Turn：`turn.started`、本轮用户消息、`model.request.started`、assistant 事件、`tool.*`，边界改由 `conversation.turn.*` 界定。

5. **历史只追加前缀，不覆盖尾部**：更早的历史通过 `olderCursor` 分页加载后前插，永远不触碰 live 尾部。删除 Turn 结束后重拉全量历史的逻辑；编辑、fork 需要的文档坐标（`entryId` / `parentId` / branch）由 `conversation.message.appended` 携带。若短期内做不到，只允许一个按 id 的纯元数据补丁 action，禁止结构性合并。

6. **乐观消息是独立的一层**：发送时生成 `messageId`（ADR-0142 已贯通 admission），写入 `pendingUser`；`message.appended` 按同一 id 精确确认后移入 `durable`；prompt 被拒时 `user.sendRejected` 删除。不再有序号、文本、次数上限等匹配逻辑。

7. **会话侧状态与消息流分离**：上下文用量、压缩、队列、todo、plan、goal、后台任务、子 agent、激活工具集，各自以小 handler 订阅同一事件流，不再写在消息事件控制器的 if 链里。输入预测只作为 `conversation.turn.completed` 的订阅方存在，只有一份实现。

8. **渲染层按条目订阅**：行组件只订阅自己那条消息，流式输出时只重渲尾部；`isStreaming` / `messages.length` 不再是 `itemContent` 的依赖。滚动只保留「是否贴底」一个状态，交给 Virtuoso 的 `followOutput`，去掉自绘 lerp；尺寸缓存与视口快照按稳定 item id 失效，而不是按 `length:first:last`。

9. **三条路径收敛**：Viewer 是只有 `durable` 的 feed；Team 的 live 覆盖层并入同一 reducer（参与者由 `authorId` 区分）；Workflow 同 Viewer。

## 实施计划

每一阶段独立提交、独立可回滚，不开长期分支。

| 阶段 | 内容 | 删除 | 风险 |
|---|---|---|---|
| P0 护栏 | 场景回放测试夹具：输入「快照 / 事件序列 / 用户操作」脚本，断言列表的 `(id, kind, phase, text)`。先用它固化现有正确行为，并为已知 bug 写失败用例（切回运行中 Turn、立即发送、队列提升、中止、失败重发、手动压缩、历史回填竞态） | — | 低 |
| P1 协议收敛 | Renderer 删除 legacy 事件分支与 `identityProtocolRef`；新会话发送前的草稿改为 `pendingTurn` 占位，不再依赖 `draft-` 前缀收养 | `draftId`、`ensureDraft`、`appendText/ThinkingDelta`、`finalizeMessage`、legacy `model.request.started` 分支 | 低：发送方已不存在 |
| P2 attach 合同 | runtime-core：relay 以 `conversation.turn.*` 界定 in-flight 缓冲与 running 状态，缓冲覆盖整个活动 Turn；新增 `attach` 返回快照与水位、历史分页游标；`message.appended` 携带文档坐标。只做加法，旧 IPC 保留 | — | 中：跨 runtime-core / main / preload 合同 |
| P3 Feed Store | 引入 `ConversationFeedState` + reducer + `atomFamily`，改用 attach 打开会话；全部写入点改为 dispatch；delta 合批改为按会话键的调度器 | `chatMessagesAtom`、`live-history-patch.ts`、`chat-message-snapshot.ts` 的合并逻辑、`restoreAssistantTurn`、`adoptTurn`、`chatStreamOwner`、Turn 结束后的历史重拉 | 高：主改造，靠 P0 兜底 |
| P4 乐观层 | `pendingUser` 取代模块级缓存；新会话走临时键 + `feed.rekeyed` | `optimistic-user-message-cache.ts`、`planFailedResendRollback` 的文本判据 | 中 |
| P5 事件路由拆分 | 会话侧状态 handler 化；输入预测只保留一份 | `useSessionEventController` 的大 if 链 | 低 |
| P6 渲染与滚动 | 行级订阅、派生模型按 item 引用缓存、滚动模型瘦身。用 `perf-message-scroll` 对比改造前后 | 自绘 lerp、粗粒度 identity key | 中 |
| P7 收敛 Team / Viewer | Team 覆盖层与 Viewer 并入同一 reducer | `reduceTeamStreamState` 的重复部分、Viewer 的独立状态 | 中 |

依赖关系：P0 → P1 → P2 → P3 → P4；P5 可与 P3 并行；P6、P7 在 P3 之后。

## 不变量（P0 测试与后续评审的验收标准）

1. 同一 `messageId` / assistant 分段 id 在列表中至多出现一次，无论事件重放或重复到达多少次。
2. 旧 Turn 的任何事件（含迟到的终态）都不能改变其他 Turn 的消息。
3. 历史加载只追加前缀或按 id 更新元数据，永不删除、重排 `watermark` 之后产生的消息。
4. 切走再切回运行中的会话后，列表与从未离开时逐项相等（除 UI 本地的展开状态）。
5. 乐观消息要么被同 id 的 `message.appended` 确认，要么被 `user.sendRejected` 移除，不存在第三种退出路径。
6. 一个会话的事件永远写不进另一个会话的 feed，且这一点由状态键保证，而不是闸门判断。

## 备选方案

- **继续在现有结构上逐个修补**：每个修复成本低，但每种新的事件交错都需要新的启发式，过去 5 个月的 fix 数量说明这条路不收敛。
- **每次事件后整表重拉历史**：实现最简单，但高频 I/O、流式块丢失、落后快照覆盖新内容，ADR-0142 已否决。
- **一次性重写并在长期分支上替换**：结构最干净，但与目标模式、Team 等并行开发冲突大，回归面难以评审。故选择按阶段替换，每阶段都有删除项。
- **把完整 feed 状态搬到 Main，Renderer 只做视图**：可跨窗口共享，但流式高频数据要额外穿一次 IPC 序列化，移动端镜像也需重做。暂不采用；本方案的 reducer 是纯函数，将来可直接搬到 Main。

## 后果

- 消息列表的正确性从「多个合并函数在各种交错下都碰巧正确」变为「单个 reducer 满足上述不变量」，可以对事件排列做属性测试。
- 后台会话在订阅期间持续更新自己的 feed，切回无需伪造草稿；是否对非活动会话保持订阅，由内存与 IPC 成本决定，不影响正确性。
- runtime-core 的 relay 合同改变：in-flight 缓冲与 running 状态不再依赖 legacy lifecycle。CLI host、宠物、通知、远程镜像等 Main 侧消费方仍能收到 legacy 事件，它们对 `message.final` 的处理是否清理另行评估。
- P3 期间会同时存在新旧两条打开会话的路径，需要以功能开关隔离，并在 P4 结束前移除旧路径。
