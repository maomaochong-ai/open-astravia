# @vetta/agent-team

## [Unreleased]

### Added

- Ordinary coordination/member Conversation bindings, persistent work-item/attempt/publication contracts, roster discovery and Team-safe observation tokens.
- Agent Team domain contracts, deterministic public-context projection, and structured delegation tool.
- Extensible orchestration/context policy registry and capability extension selections, with built-in Scene capability routing.
- Versioned built-in Agent/team presets, all-capability selection semantics, deletable-profile input validation, and persisted member profile identity for deterministic runtime reconfiguration.

### Changed

- Public-context policies receive ordinary coordination messages and retain selection authority; projected records preserve authors and artifact references, deduplicate legacy events, and exclude private execution content.
- Team user and member output now use attributed ordinary Conversation messages; member runtimes use the normal Conversation path allocator and receive structured public-context imports instead of prompt-text concatenation.
- Team contracts now support atomic roster updates, reviewed cascade deletion, and session roster revisions while preserving historical member identities.
- Team session streaming now exposes ordered turn lifecycle events and reconnect snapshots while keeping private reasoning and tool data outside the renderer contract.
- Team messages carry filesystem attachments as validated `PromptAttachmentRef` values instead of encoding paths into prompt text; existing session events remain compatible because attachments are optional.
