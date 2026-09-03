# @vetta/agent-team

## [Unreleased]

### Added

- 新增结果发布事务 observation 合同，覆盖准备、公开消息落盘、完成与待恢复阶段，并以 `recovered` 区分普通执行和重启补偿；payload 只保存 Team/Conversation/work/attempt/message 等关联身份。
- External-condition recovery now carries optional provider/model identity, matches only persisted `after-external-change` issues, and keeps legacy identity-less waits conservatively recoverable. Recovery observations identify manual, automatic and external-change triggers without exposing credentials or billing data.
- Member tool execution now has a content-safe Team correlation observation that joins the existing Runtime execution stream to participant, work-item, attempt and optional delivery identities. Tool-created work items persist their originating tool-call ID while legacy records remain valid.
- Shared checkpoints now compact policy-filtered public history into one attributed summary plus a bounded raw tail. Incremental summaries reuse only a fingerprint-verified predecessor, keep every source entry ID for traceability, expose the original history through `team_read_shared_history`, and publish typed summary observations without adding a concrete observer.
- `team_read_shared_history` provides caller-scoped, policy-filtered and bounded access to public source history. Stable cursors keep their original snapshot when newer messages arrive and expire when covered content or policy scope changes; private member, tool, thinking and subagent history remains inaccessible.
- Projection receipts can persist normalized policy-specific deltas alongside a shared checkpoint reference, enabling exact restoration without re-running a changed policy. Legacy receipts without a delta remain readable; missing referenced content must be repaired through a new admission.
- Deterministic shared-context checkpoint/generation and projection-receipt contracts, with common-prefix selection that respects every participant's visibility policy.
- Ordinary coordination/member Conversation bindings, persistent work-item/attempt/publication contracts, roster discovery and Team-safe observation tokens.
- Agent Team domain contracts, deterministic public-context projection, and structured delegation tool.
- Extensible orchestration/context policy registry and capability extension selections, with built-in Scene capability routing.
- Versioned built-in Agent/team presets, all-capability selection semantics, deletable-profile input validation, and persisted member profile identity for deterministic runtime reconfiguration.

### Changed

- Team Snapshot 直接返回普通 `ConversationMessageRecord[]`，流式更新改用 Runtime Core 的标准 Conversation 消息信封；删除同步阻塞的旧 `team_delegate`，协作统一使用持久、可并行和可恢复的 `team_delegate_task`/`team_wait_tasks`。
- Member public history is supplied through a turn-bound Coding Agent model-context projection; member Conversations retain references, while published assistant text is deduplicated without removing private execution blocks.
- Public-context policies receive ordinary coordination messages and retain selection authority; projected records preserve authors and artifact references, deduplicate legacy events, and exclude private execution content.
- Team user and member output now use attributed ordinary Conversation messages; member runtimes use the normal Conversation path allocator and receive structured public-context imports instead of prompt-text concatenation.
- Team contracts now support atomic roster updates, reviewed cascade deletion, and session roster revisions while preserving historical member identities.
- Team session streaming now exposes ordinary attributed Agent message events and reconnect snapshots while keeping private reasoning and tool data outside the renderer contract.
- Team messages carry filesystem attachments as validated `PromptAttachmentRef` values instead of encoding paths into prompt text; existing session events remain compatible because attachments are optional.
