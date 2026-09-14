# Changelog

All notable changes to `@vetta-org/theme-sdk` are documented in this file.

## [0.1.0] — 2026-09-14

首次发布到 npm。此前只作为 workspace 包在仓库内引用，但官方能力市场里的 shimo 插件依赖它，
没有它该插件在任何干净环境都装不上。

主题合同层：主题包声明、槽位契约与类型。

### Changed

- 包名由 `@vetta/theme-sdk` 改为 `@vetta-org/theme-sdk`：`@vetta` scope 不属于本账号，公开包统一
  发在 `@vetta-org` 下（与 plugin-sdk / plugin-vite / plugin-cli / ui 一致）。
