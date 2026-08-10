# Changelog

## [Unreleased]

### Changed

- Selected nodes are now named one by one on the input bar instead of collapsing into a single "N nodes" capsule, matching the host's new attachment strip.

### Fixed

- Kept node editors hidden during dragging and delayed a newly selected node's editor until drag end, while preserving already mounted editor state.
- Deferred generation-control option trees until their dropdown opens, avoiding a large first-frame mount when dragging an unselected generator node.
- Prevented React Flow position updates from rerendering the selected node's full generation editor during canvas dragging.
- Restored asset and generated-image previews after switching away from and back to the content-creation activity tab.
- Scoped generation failures to their originating node job instead of repeating them in the node editor, panel banner, and host notification.
- Kept node-bound editors mounted outside the card viewport and constrained long prompt inputs to internal scrolling.
- Preserved active prompt drafts across stale parent refreshes, removed colored node-card top accents, and raised placeholder contrast to a readable subdued level.
- Unified generator `@` suggestions across connected prompts and compatible media, including inline media previews and bindings.
- Centralized node editor interaction boundaries so future panels keep inputs editable while non-interactive panel areas remain draggable and text stays non-selectable.
- Reduced node editor placeholder contrast so empty prompts no longer compete with entered content.
- Restored `@` media suggestions for valid element-boundary carets, expanded candidates beyond connected nodes, and rendered image thumbnails in the picker and inline tokens.
- Restored focus and caret placement in node editors by excluding their interactive panels from React Flow canvas panning.
- Box selection now includes nodes that partially intersect the selection rectangle instead of requiring full containment.
- Restored primary-button canvas panning while keeping box selection available through Control-drag.
- Restored the “drop connection on empty canvas → create compatible node” menu: the pane click that follows `onConnectEnd` no longer immediately dismisses it.
- Node resize: disabled forced aspect ratio so corners and edges can free-resize width/height independently; edge controls are invisible hit strips (no outer frame gap) with quiet corner grips instead of a second primary border.

### Changed

- Migrated host media generation to the generic `media.submit`, `jobs`, and `artifacts` APIs so the same runtime can later consume composition Providers without depending on a specific render engine.
- The content-creation activity tab now expands to the host's maximum available panel width whenever it is activated, while remaining user-resizable afterward.
- Reworked visible project JSON as a self-describing schema v4 workflow document with explicit goals, deliverables, node purposes, typed inputs/results, semantic assets, and separate canvas layout; jobs and transient statuses remain in plugin storage, with toolkit-managed migration and TypeBox validation.
- Moved workspace project persistence to the visible root `content-creation.json`; legacy hidden projects are copied forward, and generated media now lives under the workspace `output/` folder with relative project references.
- Content assets now persist stable blob IDs and resolve host media URLs at runtime; schema v1 projects migrate automatically to schema v2.
- Limited asset preview URL resolution to eight concurrent host lookups and evicted cached references outside the current project.
- Restyled the multi-node selection outline with subdued theme colors, a thin solid border, and matching corner radii instead of React Flow's prominent default blue dotted frame.
- Replaced hand-authored plugin and node SVG icons with a consistent Lucide Iconify set, inlined static icon classes at their use sites, and corrected dock hover centers to match the rendered item widths.
- Restricted the plugin to Work mode via manifest `agent_mode: ["work"]` (hidden in Coding; ADR-0046).
- Node quick toolbar is icon-only (no inline rename) and sits 8px above the card to match the generation composer gap; identity header hides while the toolbar is open.
- Canvas Delete / Backspace now use the host plugin shortcut stack (`usePluginShortcutScope`) instead of React Flow `deleteKeyCode`, so they participate in scope priority, skip locked nodes, and stay inactive while the activity tab is hidden or focus is in an editable field.

- Node surface copy and placeholders scale with the card size (container query units) so image/video empty states stay proportional when resized.
- Softened bottom dock hover magnification (lower peak scale, narrower influence, smoother easing) to reduce visual dizziness.
- Reorganized the package by feature folders (`panel` / `canvas` / `node` / `timeline` / `project` / `generation` / `plugin` / `shared`) instead of a catch-all `domain` + flat `components` layout; split React Flow and node styles into per-area CSS files under `styles/` + feature modules.
- Removed the content-creation panel header (title, path, revision, graph/timeline switch) so the canvas uses the full tab area; timeline workspace remains in the package for later re-entry.
- Collapsed typed port capsules into one centered connection handle per card side; the UI now infers compatible logical ports while persisted edges keep their typed semantics.
- Added a Mac Dock–style magnification hover effect on the bottom node-creation dock (with reduced-motion fallback).
- Kept node bodies as zoomable content previews and mounted per-node editors in a non-scaling `NodeToolbar`, so controls remain usable at low canvas zoom.
- Polished content-creation canvas UX: node chrome, themed React Flow controls, and broader `@vetta/ui` usage (Button / Select / DropdownMenu / Slider / Spin).
- Activity tab「内容创作」默认不上栏（`initiallyVisible: false`）；由 `open_content_creation` 或用户从「+」添加后再显示。
- Replaced the permanent node inspector with content-first media nodes, persistent canvas sizing, node-bound generation composers, contextual creation menus, and a compact bottom dock inspired by Open-AI Canvas and Loomic.
- Added multi-selection alignment and layouts, lock-aware canvas geometry, drag alignment guides, viewport-clamped context menus, inline node naming, larger connection hit targets, and detailed generation job feedback.
- Simplified the canvas chrome by removing the minimap, dot background, and React Flow attribution, and separated node interaction overflow from the clipped content shell.
- Moved node identity into an external header, added hover-discoverable quick actions, simplified content surfaces, and memoized node rendering while keeping full generation settings selection-bound.

### Added

- Added a structured, persistent input-bar context for the current canvas selection so the agent receives selected node IDs, semantic v4 node data, adjacent connections, and safe asset summaries without canvas layout, jobs, timestamps, previews, or private storage IDs.
- Added input-bound, opt-in prompt optimization through host-managed AI models with reusable node-specific profiles; successful results replace the effective prompt while preserving the structured original.
- Added host media-provider discovery and image generation through the plugin media capability, with generated artifacts persisted as visible workspace output files.
- Added structured multimodal prompt documents with compact inline media tokens and mixed `@` prompt references, preserving editable local text while carrying referenced media into generation model compatibility checks.
- Upgraded asset nodes into scalable image, video, and audio collections with recursive file or folder drop, host-side zero-Base64 import, canvas drop-to-create, compact summaries, incremental management, and model-compatible selection from connected generation nodes.
- Added explicit select and hand tools to the canvas dock with visible active state.
- Added the initial content-creation canvas and multitrack composition preset foundation.
- Added reference-project design notes, a schema-driven node registry, typed ports, connection validation, compatible-node creation, and node workflow tests.
- Added secure plugin credentials, provider/model registration, a real OpenAI-compatible image adapter, generation jobs, artifact return, and fully mocked tests.
- Added capability-based OpenAI Images, Replicate, Gemini/Veo, and configurable NewAPI video adapters with the Loomic media model catalog.
- Added model-declared image/video reference slots, persistent reference imports, shared compatibility resolution, and multimodal Provider request mapping.

### Fixed

- Replaced controlled React Flow node and edge props with internal transient canvas state plus one-way project snapshot synchronization, preventing drag and ResizeObserver updates from feeding back through the StoreUpdater passive effect.
- Fixed typed connection ports being clipped by the node content container; ports now remain discoverable and reveal their labels on hover or selection.
