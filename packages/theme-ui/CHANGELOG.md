# @vetta/theme-ui

## [Unreleased]

### Added

- Bash 工具终端状态支持 `cancelled`，取消后不再显示运行中的光标或等待提示。

- Exported shared `AvatarStackView` for a compact overlapping avatar row with a bounded overflow count, replacing the session-row-only stack implementation.

### Changed

- Session rows support a source icon with trailing participant avatars, no longer reserve trailing space for relative timestamps, and apply project-child indentation consistently across source and status icon variants.
- MessageFeed.VirtualList 现在支持按条目数设置最小预渲染范围和恢复 Virtuoso 状态快照，动态高度消息在滚动和会话恢复时可避免批量重测导致的布局跳动。
- Replaced the fixed ActivityPanel view shell with Radix-style compound primitives and changed the Browser panel identity contract from a conversation path to an explicit workspace ID.
- Replaced the fixed message-input region and toolbar prop contracts with Radix-style compound primitives, Context-owned state, optional DropZone composition, and `asChild` DOM polymorphism.
- Replaced the fixed chat message-list shells with orthogonal `MessageFeed` / `Message` behavior primitives, `MessageFeedLayout` / `MessageLayout` positional primitives, and `MessageVisual` leaves. Feed mechanics, layout positions, message abilities, visuals, and caller-owned host elements can now be assembled independently through explicit children and Radix-style `asChild` composition.
