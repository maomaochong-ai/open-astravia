# @vetta/agent-team

## [Unreleased]

### Added

- Agent Team domain contracts, deterministic public-context projection, and structured delegation tool.
- Extensible orchestration/context policy registry and capability extension selections, with built-in Scene capability routing.
- Versioned built-in Agent/team presets, all-capability selection semantics, deletable-profile input validation, and persisted member profile identity for deterministic runtime reconfiguration.

### Changed

- Team contracts now support atomic roster updates, reviewed cascade deletion, and session roster revisions while preserving historical member identities.
- Team session streaming now exposes ordered turn lifecycle events and reconnect snapshots while keeping private reasoning and tool data outside the renderer contract.
- Team messages carry filesystem attachments as validated `PromptAttachmentRef` values instead of encoding paths into prompt text; existing session events remain compatible because attachments are optional.
