# Changelog

All notable changes to `@vetta-org/theme-ui` are documented in this file.

## [Unreleased]

### Added

- 新增 `./markdown` 公开入口：局部 Markdown definition、remark/rehype 与元素扩展，以及可组合的 `CodeBlock`。Chat 与活动面板预览共享扩展定义，原 `chat/TextBlockView` 保留转导出。

### Changed

- `MessageFeed.VirtualList.children` 改为单一逐项渲染函数，不再接受声明式 List/Footer 子元素；Footer 在同一 Root 中正常组合并 Portal 到虚拟列表末尾。外部消费者需按 Desktop 的消息列表扩展指南迁移。
- 为 Footer Portal 声明 ReactDOM 19 peer dependency。

## [0.1.1] — 2026-09-14

### Fixed

- 依赖 `@vetta-org/theme-sdk` 与 `@vetta-org/ui` 改用 registry semver。0.1.0 把它们以
  `workspace:*` 发了出去，而那是 bun/pnpm 的协议、npm 不认，导致该版本在任何地方都装不上。
  仓库内仍解析到本地包（版本匹配），行为不变。

## [0.1.0] — 2026-09-14

首次发布到 npm。此前只作为 workspace 包在仓库内引用，但官方能力市场里的 shimo 插件依赖它，
没有它该插件在任何干净环境都装不上。

宿主成品 UI。其中 `./plugin-ui` 是**有意收窄**的插件面：插件通过 Module Federation 共享宿主的同一份实例，npm 依赖只用于编译期类型。

### Changed

- 包名由 `@vetta/theme-ui` 改为 `@vetta-org/theme-ui`：`@vetta` scope 不属于本账号，公开包统一
  发在 `@vetta-org` 下（与 plugin-sdk / plugin-vite / plugin-cli / ui 一致）。
