# @vetta/theme-ui

## [Unreleased]

### Changed

- Replaced the fixed message-input region and toolbar prop contracts with Radix-style compound primitives, Context-owned state, optional DropZone composition, and `asChild` DOM polymorphism.
- Replaced the fixed chat message-list shells with orthogonal `MessageFeed` / `Message` behavior primitives, `MessageFeedLayout` / `MessageLayout` positional primitives, and `MessageVisual` leaves. Feed mechanics, layout positions, message abilities, visuals, and caller-owned host elements can now be assembled independently through explicit children and Radix-style `asChild` composition.
