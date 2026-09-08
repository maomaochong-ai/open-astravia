# @vetta/agent-team

## [Unreleased]

### Added

- Team sessions can persist an independent, automatically generated conversation title without coupling historical conversations to the mutable Team name.
- Team session contracts now expose catalog summaries, stable workspace identity, and persisted per-session model/reasoning settings; send requests may carry the resolved turn configuration through the existing member runtime path.
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
- Initial Agent/team resources, all-capability selection semantics, deletable-profile input validation, and persisted member profile identity for deterministic runtime reconfiguration.

### Changed

- Initial Agent Profiles and teams now use ordinary UUID identities and the same contracts as user-created data; preset identity/version fields and startup reseeding were removed.

- Team session workspace snapshots and catalog summaries now expose semantic `team-default`, `session`, or `project` workspace kinds. New hosts can allocate isolated session workspaces while continuing to read legacy Team-owned defaults without inferring storage paths.

- Team message routing now persists validated structured member-mention annotations separately from orchestration-resolved delivery targets. Member-scoped visibility no longer infers user intent from `@handle` text.

- Team session record creation can now carry an optional project workspace selection; the resolved workspace identity and cwd remain immutable session snapshots, while omitted selections allocate a workspace owned by the new session.

- Team session activities now preserve the optional originating tool-call ID from collaboration work items, allowing host displays to attach member progress to the exact delegation tool without changing persisted Conversation messages.

- Team session record creation accepts the initial execution mode so member Runtime warmup uses the user-selected mode from the beginning.

- Team session activities optionally expose the member `sourceTurnId` used by display-only Team progress projections; this does not widen shared-context or public Conversation visibility.

- Clarify `team_send_message` question semantics: per-recipient delivery IDs are not task IDs for `team_wait_tasks`, and published replies arrive through automatic initiator continuations or shared history.
- Team session contracts now distinguish an eagerly visible coordination record from preparing, ready, or failed member Runtime state, while preserving the active roster independently from the currently prepared Runtime subset.
- Team Snapshot 直接返回普通 `ConversationMessageRecord[]`，流式更新改用 Runtime Core 的标准 Conversation 消息信封；删除同步阻塞的旧 `team_delegate`，协作统一使用持久、可并行和可恢复的 `team_delegate_task`/`team_wait_tasks`。
- Member public history is supplied through a turn-bound Coding Agent model-context projection; member Conversations retain references, while published assistant text is deduplicated without removing private execution blocks.
- Public-context policies receive ordinary coordination messages and retain selection authority; projected records preserve authors and artifact references, deduplicate legacy events, and exclude private execution content.
- Team user and member output now use attributed ordinary Conversation messages; member runtimes use the normal Conversation path allocator and receive structured public-context imports instead of prompt-text concatenation.
- Team contracts now support atomic roster updates, reviewed cascade deletion, and session roster revisions while preserving historical member identities.
- Team session streaming now exposes attributed text and tool-call events plus reconnect snapshots to the local user interface. Public-context projection still excludes reasoning and tool input/output from other members' model context.
- Team messages carry filesystem attachments as validated `PromptAttachmentRef` values instead of encoding paths into prompt text; existing session events remain compatible because attachments are optional.
