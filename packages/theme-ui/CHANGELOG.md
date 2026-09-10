# @vetta/theme-ui

## [Unreleased]

### Added

- `NewSessionHero` props carry an optional `identity` (title, subtitle, and one avatar per team member) so a theme can render the picked agent or team in place of the greeting.
- Exported shared `AvatarStackView` for a compact overlapping avatar row with a bounded overflow count, replacing the session-row-only stack implementation.
- Exported `NewSessionAmbientGlow` on its own so a host can swap the texture layer of `NewSessionBackground` while keeping the same glow. `NewSessionBackground` is unchanged.
- Exported `NEW_SESSION_TEXTURE_MASK`, the fade every new session page texture shares. Its vertical radius is tightened so the pattern is gone before the top and bottom edges instead of being sliced off by them.

### Changed

- `NewSessionPicker.Trigger` and `ProjectSelectorView` triggers use the opaque card surface instead of a translucent accent tint.
- Session rows support a source icon with trailing participant avatars, no longer reserve trailing space for relative timestamps, and apply project-child indentation consistently across source and status icon variants.
- MessageFeed.VirtualList 现在支持按条目数设置最小预渲染范围和恢复 Virtuoso 状态快照，动态高度消息在滚动和会话恢复时可避免批量重测导致的布局跳动。
- Replaced the fixed ActivityPanel view shell with Radix-style compound primitives and changed the Browser panel identity contract from a conversation path to an explicit workspace ID.
- Replaced the fixed message-input region and toolbar prop contracts with Radix-style compound primitives, Context-owned state, optional DropZone composition, and `asChild` DOM polymorphism.
- Replaced the fixed chat message-list shells with orthogonal `MessageFeed` / `Message` behavior primitives, `MessageFeedLayout` / `MessageLayout` positional primitives, and `MessageVisual` leaves. Feed mechanics, layout positions, message abilities, visuals, and caller-owned host elements can now be assembled independently through explicit children and Radix-style `asChild` composition.
