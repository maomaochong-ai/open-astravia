# Changelog

All notable changes to `@vetta-org/ui` are documented in this file.

## [0.1.0] — 2026-09-14

首次发布到 npm。此前它只作为 workspace 包在仓库内被引用，但官方能力市场里的 feishu 与 shimo
两个插件真的 import 了它的组件，没有它们在任何干净环境都装不上。

### Changed

- 包名由 `@vetta/ui` 改为 `@vetta-org/ui`：`@vetta` scope 不属于本账号，公开包统一发在
  `@vetta-org` 下（与 plugin-sdk / plugin-vite / plugin-cli 一致）。

### Added

- 共享 React 组件库，随包发布 TypeScript 源码（`files: ["src"]`），由消费方自行编译。
