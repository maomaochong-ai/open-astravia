# Changelog

## [Unreleased]

### Changed

- Activity tab「内容创作」默认不上栏（`initiallyVisible: false`）；由 `open_content_creation` 或用户从「+」添加后再显示。
- Replaced the permanent node inspector with content-first media nodes, persistent canvas sizing, node-bound generation composers, contextual creation menus, and a compact bottom dock inspired by Open-AI Canvas and Loomic.
- Added multi-selection alignment and layouts, lock-aware canvas geometry, drag alignment guides, viewport-clamped context menus, inline node naming, larger connection hit targets, and detailed generation job feedback.

### Added

- Added the initial content-creation canvas and multitrack composition preset foundation.
- Added reference-project design notes, a schema-driven node registry, typed ports, connection validation, compatible-node creation, and node workflow tests.
- Added secure plugin credentials, provider/model registration, a real OpenAI-compatible image adapter, generation jobs, artifact return, and fully mocked tests.

### Fixed

- Replaced controlled React Flow node and edge props with internal transient canvas state plus one-way project snapshot synchronization, preventing drag and ResizeObserver updates from feeding back through the StoreUpdater passive effect.
