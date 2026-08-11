# 147：迁移旧会话真实继续执行差分闭环

## 目标

在第 146 阶段完成官方 Legacy 消息严格规范化之后，验证迁移结果不只是“能够读取”，而是能够通过真实
Provider Turn、Extension `context`、进程重启和再次持久化继续执行，并与 Legacy Runtime 保持等价。

本阶段不重构 Tool、Prompt、Skill、MCP、Provider 或 Extension 功能，也不扩大未知私有消息的自动迁移范围。

## 真实执行 Fixture

CLI 测试新增职责独立的 Legacy 执行 fixture，包含：

- 压缩前、应从活动上下文移除的旧用户消息；
- 模型可见和 `excludeFromContext` 的 `bashExecution`；
- 模型可见 `custom_message` 与模型不可见 `prompt_resource_reference`；
- 一条不在活动分支上的用户消息；
- 指向该废弃分支的 `branch_summary`；
- 带 `firstKeptEntryId` 的 `compaction`；
- 压缩后的活动分支尾部消息。

同一 fixture 分别交给 Legacy 和 Greenfield 进程。两边都执行首次真实 Provider Turn，关闭进程，使用实际
Session Path 重启后再执行第二个 Turn。

## 差分发现

初始差分测试发现两个真实缺陷：

1. 模型可见的 `bashExecution` 在 Greenfield Extension `context` 中退化为普通 `user`；
2. 活动分支上的 `branch_summary` 没有进入 Greenfield 的 Extension 上下文和 Provider 输入。

原因不在 Legacy Normalizer。`ConversationContextProjector` 原来只作为
`RuntimeMessageEnvelope` 身份候选使用，而 Turn Pipeline 的权威模型历史仍来自通用
`StoredConversation.messages`：

- 通用投影不会表达产品级 Branch Summary；
- 可见 Legacy Bash 会先被投影成普通 user；
- Bash AgentMessage 的原始时间戳与 Session Entry 时间戳允许不同，Envelope 对齐时无法重新关联原身份。

因此，产品投影即使保留了完整身份，也会在进入 Context Strategy 前被通用模型历史裁掉或降级。

## Runtime Core 修复

Turn Pipeline 现在遵守 `ConversationContextProjector` 的合同：

- 存在 Conversation Document 和产品 Projector 时，从 Projector Envelope 生成权威模型历史；
- 同一历史同时用于 Context Strategy 的 `messages` 与 `historyMessages`；
- 模型调用级 Context Checkpoint 同样使用产品投影历史；
- 无 Projector 或无 Document 时继续使用原 `StoredConversation.messages`，保持默认路径不变；
- 模型不可见 Opaque Envelope 仍保留身份，但不进入模型消息数组。

该修复只完善通用 Port 的执行语义，没有让 Runtime Core 识别 Bash、Custom、Branch Summary 或 Legacy
JSONL 格式。

## Provider 与 Extension 差分门禁

真实子进程测试现在验证：

- 首次和重启后第二次 Provider 输入在 Legacy/Greenfield 间完全相等；
- Extension `context` 每个进程、每次模型调用只执行一次；
- `compactionSummary`、两个 `bashExecution`、两个 Custom 身份和 `branchSummary` 顺序一致；
- 隐藏 Bash 与 Prompt Marker 对 Extension 可观察，但不会进入 Provider；
- 压缩前历史和废弃分支正文不会进入 Provider；
- Compaction Summary、Branch Summary、可见 Bash、可见 Custom 和活动尾部均进入 Provider；
- 重启复用同一个 Session ID 和 Session Path，不产生第二个迁移目标；
- Legacy 源文件保持字节级不变；
- 两个新 Turn 的 user/assistant Entry 形成连续父子链，所有 Parent 引用均可解析。

## 独立安装产物

独立 `vetta` 可执行产物测试不再只对迁移会话调用 `get_state`。它现在：

1. 打开综合 Legacy fixture 并自动迁移；
2. 加载 Extension，执行第一个真实 Provider Turn；
3. 关闭进程并使用迁移后的 `.conversation.jsonl` 重启；
4. 执行第二个 Provider Turn；
5. 验证 Extension 身份、Provider 可见性、源文件只读、迁移目标唯一和新增消息持久化。

未知 Entry 的失败关闭与 Legacy fallback 用例继续保留。

## 测试

- Runtime Core Turn Pipeline：17 项通过；
- CLI 真实 Provider 差分：11 项通过；
- 独立安装可执行产物：6 项通过；
- `bun run check:quick` 通过；
- 根目录 `bun run check` 通过，包括 Biome、monorepo 类型、CLI、Desktop、Admin 与质量守卫；
- `git diff --check` 通过。

## 结果

官方 Legacy 会话已经完成“严格识别 → 只读迁移 → 产品身份投影 → 真实 Provider 执行 → 进程重启 →
继续持久化”的闭环。`ConversationContextProjector` 也从辅助身份信息修正为真正的产品上下文权威边界，避免
通用模型投影覆盖产品语义。

## 下一步

下一阶段应验证迁移 Seed 与新增 V2 Event 混合树上的历史修改行为，包括活动分支切换、消息编辑/重试、删除
重写和跨会话 Fork。重点是验证引用重映射、Compaction `firstKeptEntryId`、Branch Summary `fromId`、活动叶节点
和 Legacy fallback 决策，不增加新的格式兼容类型。
