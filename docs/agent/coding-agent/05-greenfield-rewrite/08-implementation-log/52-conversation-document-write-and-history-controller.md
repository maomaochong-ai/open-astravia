# 第 52 轮：Conversation Document 写模型与 Greenfield History Controller

## 目标

在默认生产入口继续使用 Legacy Backend 的前提下，让原生 V2 会话具备可恢复的树形历史写能力，并让
Greenfield Core Assembly 交付真实 `RuntimeSessionHistoryController`。

本轮验收条件：

1. Kernel Event journal 与历史文档写 revision 独立演进，不能互相冒充版本号。
2. 分支选择、编辑导航、删除、替换、命名与 fork 通过 Runtime-owned 命令表达。
3. 结构修改采用乐观 revision，多个 Repository 实例写同一文件时只能有一个成功。
4. 下一次 Turn 必须读取所选活动分支，而不是仍把线性事件中的所有消息发给模型。
5. 旧 V1 文件保持可读取和可追加，但历史写命令明确只读失败，不隐式升级。
6. 旧历史操作的可观察行为和引用修复规则由测试保护。

## 分析结论

### 1. 需要两个版本，不需要整份快照

原实现把 `ConversationDocument.revision` 等同于 Kernel event sequence，历史命令一旦不产生 Kernel Event，
两者就无法继续共享一个数字。本轮将其拆成：

- `journalVersion`：已应用的 Kernel Event 数，只服务 Turn 恢复和追加。
- `revision`：文档乐观版本，消息 entry 和文档命令都会推进。

历史修改以小型 `conversation.document.operation` 追加记录持久化。一次只写命令，不重写或复制整份会话；
读取时按文件物理顺序重放 Event 和 Document Operation。因此局部变化不会触发“整个快照重建”。

### 2. 活动分支属于会话文档，不属于 UI

如果 Repository 仍从线性事件数组构造 `StoredConversation.messages`，UI 的分支切换不会影响下一次模型调用。
本轮改为从 `ConversationDocument.activeLeafId` 投影 root-to-leaf 消息；Turn Pipeline 原有的
`repository.load()` 调用自然取得当前活动分支，不需要让 Kernel 依赖 UI 历史类型。

### 3. 结构命令与名称元数据使用不同并发策略

- 删除、替换、分支选择和编辑导航必须携带 `expectedRevision`，冲突时稳定返回
  `conversation_document_version_conflict`。
- 会话名称是可交换元数据。为保持旧实现“运行中也可重命名”的行为，它允许在最新 revision 上执行；
  存储边界禁止其他结构命令绕过 expected revision。
- 单 Repository 内的 Promise queue 负责进程内顺序；文件锁负责多个 Repository 实例之间的写互斥。

### 4. Legacy 文件只读不是功能删除

旧 coding-agent v1-v3 文档仍由 importer 完整读取。原生 V1 conversation 也仍可按原格式追加 Kernel Event。
但两者没有可安全承载新 document operation 的 envelope，因此历史写入返回明确 `READ_ONLY`；不能在 resume
时偷偷覆盖用户文件。后续迁移必须是显式 import/export 操作。

## 已实施

### Runtime Core

- 新增 `ConversationDocumentCommand` 判别联合、纯命令执行器和 `ConversationDocumentStore` Port。
- 新增 active branch message/entry 投影、user-turn tip 解析和文本提取。
- 删除单条消息时保留子树并重挂 parent，同时修复 label、`branch_summary.fromId` 与
  `compaction.firstKeptEntryId`。
- 替换最后一条 user 时删除该 user 的完整回复子树，并把 leaf 返回到其 parent。
- `RuntimeSessionHistoryController` 的写操作统一为异步合同；Legacy Adapter 仍在 Promise 创建前同步执行原操作。
- Greenfield Controller 实现编辑导航、切分支、删除、替换、fork 和命名，并与投影同步。

### Runtime Storage

- V2 新增 TypeBox 校验的 `conversation.document.operation` record。
- `FileConversationRepository` 实现 `execute()`、`fork()` 和独立文档 revision 冲突检测。
- 文件职责拆分为 Repository 编排、JSONL codec/projection、文件锁和 Node 错误码提取模块，避免把解析、锁与
  会话 API 继续堆入同一个大文件。
- `load()` 从活动文档分支构建模型消息；命令和 Event 可交错重放。
- 读写路径共享跨 Repository 实例的文件锁：覆盖 Event、Document Operation 和 Snapshot 写入，并避免读取到
  尚未完整追加的 JSONL record。
- 新增稳定错误码：文档 revision 冲突、非法命令、只读格式和写锁超时。
- fork 生成独立、可恢复的 V2 文件，并写入 source path 与 parent entry 血缘。

### Greenfield 能力矩阵

已实现能力由 4 项增加为 5 项：

- lifecycle
- historyReader
- historyController
- workspaceView
- corePorts

其余 7 项继续是 `missing`，没有 fallback 或空实现。

## 行为兼容性

- 编辑 user/custom message 后 leaf 移到 parent；编辑其他节点时 leaf 留在目标节点。
- 分支切换选择目标子树的最新 tip，并立即改变 UI 历史和后续模型上下文。
- fork 只保留所选 user turn 及其 assistant/tool 后代，不包含下一条 user turn。
- 名称写入继续 trim，并允许活动 Turn 期间执行。
- 结构性历史操作继续在活动 Turn 时拒绝执行。
- 默认 RuntimeHost 和 Legacy Backend 没有切换；现有生产文件写行为保持原路径。

## 测试

- Runtime Core 纯命令测试覆盖分支选择、删除/reparent、引用修复、替换、幂等 leaf 与 revision 校验。
- Runtime Storage 测试覆盖 V2 命令重放、活动分支模型消息、跨实例冲突、V1 只读、TypeBox 读写边界和 fork 恢复。
- 真实文件 Greenfield 集成测试覆盖 edit → 新分支 → branch switch → prompt → replace → resume 全链路。
- 录制 Turn Engine 断言模型只收到当前活动分支。
- 阻塞 Turn Engine 验证运行中命名与后续 Event 投影 revision 一致。

验证结果：

- `packages/runtime-core`：22 个测试文件、105 项测试全部通过。
- `packages/runtime-storage`：4 个测试文件、25 项测试全部通过。
- 根目录 `bun run check:quick` 通过。
- 根目录 `bun run check` 通过：Biome、monorepo `tsgo`、desktop-app `tsc`、admin `tsc -b` 和
  `check:guards` 均无错误。

## 明确未修改

- 未切换默认生产 RuntimeHost 到 Greenfield Backend。
- 未自动迁移或重写 Legacy/V1 会话。
- 未改变 Prompt、Tool、Skill、MCP、上下文压缩或模型调用语义。
- 未实现剩余 7 项 Greenfield RuntimeHost 外围能力。
- 未删除任何旧 SessionManager、Adapter 或兼容导出。

## 下一步

下一阶段优先实现 Greenfield 的 Runtime-owned 模型状态边界：定义可热更新但不泄漏 Registry 的 model catalog、
selection 与 credential resolution，令 `modelController + modelView + stateSource` 共享同一事实来源，并验证切模只影响
后续 Turn 的 Snapshot。完成前仍不把 Greenfield Backend 注入默认 RuntimeHost。
