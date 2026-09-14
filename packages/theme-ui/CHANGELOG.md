# Changelog

All notable changes to `@vetta-org/theme-ui` are documented in this file.

## [0.1.0] — 2026-09-14

首次发布到 npm。此前只作为 workspace 包在仓库内引用，但官方能力市场里的 shimo 插件依赖它，
没有它该插件在任何干净环境都装不上。

宿主成品 UI。其中 `./plugin-ui` 是**有意收窄**的插件面：插件通过 Module Federation 共享宿主的同一份实例，npm 依赖只用于编译期类型。

### Changed

- 包名由 `@vetta/theme-ui` 改为 `@vetta-org/theme-ui`：`@vetta` scope 不属于本账号，公开包统一
  发在 `@vetta-org` 下（与 plugin-sdk / plugin-vite / plugin-cli / ui 一致）。
