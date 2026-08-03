# Changelog

## [Unreleased]

### Fixed

- Restored the “drop connection on empty canvas → create compatible node” menu: the pane click that follows `onConnectEnd` no longer immediately dismisses it.
- Node resize: disabled forced aspect ratio so corners and edges can free-resize width/height independently; edge controls are invisible hit strips (no outer frame gap) with quiet corner grips instead of a second primary border.

### Changed

- Restricted the plugin to Work mode via manifest `agent_mode: ["work"]` (hidden in Coding; ADR-0046).
- Node quick toolbar is icon-only (no inline rename) and sits 8px above the card to match the generation composer gap; identity header hides while the toolbar is open.
- Canvas Delete / Backspace now use the host plugin shortcut stack (`usePluginShortcutScope`) instead of React Flow `deleteKeyCode`, so they participate in scope priority, skip locked nodes, and stay inactive while the activity tab is hidden or focus is in an editable field.

- Node surface copy and placeholders scale with the card size (container query units) so image/video empty states stay proportional when resized.
- Softened bottom dock hover magnification (lower peak scale, narrower influence, smoother easing) to reduce visual dizziness.
- Reorganized the package by feature folders (`panel` / `canvas` / `node` / `timeline` / `project` / `generation` / `plugin` / `shared`) instead of a catch-all `domain` + flat `components` layout; split React Flow and node styles into per-area CSS files under `styles/` + feature modules.
- Removed the content-creation panel header (title, path, revision, graph/timeline switch) so the canvas uses the full tab area; timeline workspace remains in the package for later re-entry.
- Refined node connection ports into edge-welded capsules that share card surface tokens (type only as a small dot), replacing the earlier ribbon/bookmark look.
- Added a Mac Dock–style magnification hover effect on the bottom node-creation dock (with reduced-motion fallback).
- Mounted the per-node generation panel inside the node shell (not `NodeToolbar`) so its width tracks node resize and scales with canvas zoom.
- Polished content-creation canvas UX: node chrome, themed React Flow controls, and broader `@vetta/ui` usage (Button / Select / DropdownMenu / Slider / Spin).
- Activity tab「内容创作」默认不上栏（`initiallyVisible: false`）；由 `open_content_creation` 或用户从「+」添加后再显示。
- Replaced the permanent node inspector with content-first media nodes, persistent canvas sizing, node-bound generation composers, contextual creation menus, and a compact bottom dock inspired by Open-AI Canvas and Loomic.
- Added multi-selection alignment and layouts, lock-aware canvas geometry, drag alignment guides, viewport-clamped context menus, inline node naming, larger connection hit targets, and detailed generation job feedback.
- Simplified the canvas chrome by removing the minimap, dot background, and React Flow attribution, and separated node interaction overflow from the clipped content shell.
- Moved node identity into an external header, added hover-discoverable quick actions, simplified content surfaces, and memoized node rendering while keeping full generation settings selection-bound.

### Added

- Added the initial content-creation canvas and multitrack composition preset foundation.
- Added reference-project design notes, a schema-driven node registry, typed ports, connection validation, compatible-node creation, and node workflow tests.
- Added secure plugin credentials, provider/model registration, a real OpenAI-compatible image adapter, generation jobs, artifact return, and fully mocked tests.
- Added capability-based OpenAI Images, Replicate, Gemini/Veo, and configurable NewAPI video adapters with the Loomic media model catalog.

### Fixed

- Replaced controlled React Flow node and edge props with internal transient canvas state plus one-way project snapshot synchronization, preventing drag and ResizeObserver updates from feeding back through the StoreUpdater passive effect.
- Fixed typed connection ports being clipped by the node content container; ports now remain discoverable and reveal their labels on hover or selection.
