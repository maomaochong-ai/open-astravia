# Changelog

All notable changes to `@vetta/runtime-storage` are documented in this file.

## [Unreleased]

### Breaking Changes

- **退役 Coding Agent 存储兼容根**：包根改为暴露原生 Conversation API，不再转发 `AuthStorage`、`SessionManager`、`SettingsManager`；认证与设置继续由产品宿主拥有。

### Added

- **Turn 外 Context 与 Entry Label 持久化**：Conversation V2 TypeBox Schema 新增无 `turnId` 的 `context.recorded`，可在不启动模型 Turn 时保存模型/UI 可见上下文；Repository 同时支持无预读 revision 的 Session 元数据、Custom Entry 与 Label 追加写入，并保持重开后的分支投影。
- **跨 Conversation 续接事务**：`FileConversationRepository` 可从最近原生压缩边界创建带血缘的目标会话，TypeBox 校验 continuation seed 并重写 carried tail identity；源会话以 `turn.transferred` 闭合、目标会话以 `turn.continued` 延续同一 Turn，版本冲突不会留下目标文件，重开后保持摘要与尾部模型投影。
- **Turn 外手动压缩持久化**：Conversation V2 Schema 允许 `reason: "manual"` 的 `context.compacted` 不携带 `turnId`，并在关闭、重开后继续投影为相同的摘要与保留尾部；活动 Turn 内的压缩协议仍由 Runtime Core 严格校验。
- **原生 Context Compaction 持久化**：Conversation V2 TypeBox Schema 支持摘要消息、保留边界、token 用量和触发原因，并将压缩记录投影为分支节点；旧计数型 `context.compacted` 记录继续可读且不改变历史分支。
- **分支级 Custom Document Entry 持久化**：V2 Repository 支持 TypeBox 校验的 `custom.append` operation、事件 parent 对 custom entry 的完整性校验及 fork 重放，为 Todo 等产品状态提供不泄漏业务类型的会话内持久化边界。
- **Conversation Context Record 持久化**：V2 TypeBox 事件 Schema 新增 `context.appended`，将模型可见隐藏上下文与模型不可见业务 marker 保存为原生分支节点；Repository 恢复模型上下文时保留顺序，聊天消息投影不暴露隐藏记录。
- **Conversation V2 历史写入与并发控制**：新增 TypeBox 校验的 Document Operation、乐观 document revision、跨 Repository 文件读写锁和可恢复 fork；原生 V1 保持可读/可追加但历史命令只读失败，活动分支决定 Repository 返回的模型消息。
- **Conversation V2 与 Legacy History Importer**：原生 JSONL V2 event envelope 保存稳定 document entry identity，并继续严格读取和原格式追加 V1；`FileConversationRepository` 新增 Conversation Document 读取，另提供不依赖 coding-agent 的 Legacy v1-v3 只读 importer，覆盖旧新历史差异和损坏 parent 校验。
- **Greenfield Session Projection 集成**：`FileConversationRepository` 新增稳定绝对会话文件路径解析，并通过真实文件 create、prompt、dispose、resume 验证 Runtime Core 同步状态和消息投影可重建。
- **Conversation TypeBox Schema**：为 Message、Session Event、JSONL Record 和 Snapshot 增加完整运行时 Schema；Repository 在写入边界拒绝非法领域对象，并在读取时将结构正确但语义非法的记录判定为损坏。
- **版本化文件会话仓储**：新增 `@vetta/runtime-storage/conversation` 和 `FileConversationRepository`，支持事件顺序、乐观版本、原子 Snapshot 写入及损坏记录检测。
- **进程内 Conversation 仓储**：新增 `InMemoryConversationRepository`，同时实现 Kernel/Document/Continuation 三个合同而不产生可恢复文件路径，保留版本冲突、Document revision、fork、compaction continuation 与关闭后拒绝访问语义。

### Fixed

- **会话删除与外部产物清理保持同一可重试事务**：文件会话目录支持可注入的产物 Cleaner，并在删除 Snapshot 和会话文件前执行；清理失败时保留会话及其锁内可重试状态，Storage 不依赖具体 Tool 或 Coding Agent 实现。
- **Conversation ownership 释放可重试**：文件 lease 仅在确认锁已释放或已不存在后停止心跳并标记完成；瞬时文件系统错误会保留释放资格，并发调用复用同一在途操作，使 Session 清理失败后可由 Runtime 最终关闭再次释放锁。
