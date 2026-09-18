# Changelog

All notable changes to `@vetta-org/theme-ui` are documented in this file.

## [Unreleased]

### Added

- 新增 `./markdown` 公开入口：局部 Markdown definition、remark/rehype 与元素扩展，以及可组合的 `CodeBlock`。Chat 与活动面板预览共享扩展定义，原 `chat/TextBlockView` 保留转导出。
- 流式 Markdown 只把已经闭合的代码围栏冻成稳定块，后续 token 只重跑尾块；空行不再拆段，避免把松散列表和缩进代码拆进多个文档。代码高亮在围栏仍在增长或滚出视口时改为等宽纯文本，避免热路径反复跑 Shiki。

### Changed

- 思考中卡片的入场改为 CSS grid 过渡，滚动追随只在正文变化后短跑 rAF，不再整段思考期间无限动画帧。
- `SidebarPanel` 新增 `panelRef`，`SidebarModel` 新增 `setPanelRef`：宿主在拖拽宽度时直接往面板元素写 `style.width`，`width` 作为 committed 值只在松手时由 React 写回。左栏占位仍用 committed 值，因此拖拽期主内容区不重排。
- `SidebarDock` 改为抽屉式过渡并新增必填 `width`（px，与侧边栏面板宽度同源）：占位宽度在切换瞬间落到终值、不参与过渡，面板脱离占位盒子用 `transform` 滑动，主内容区因此只重排一次；子树挂过一次不再随收起卸载，收起态带 `inert` + `aria-hidden`（也是「左栏不在位」的样式钩子）。宿主需传入 `width`，并把依赖「收起时左栏节点不存在」的选择器改为按 `inert` 判定。
- `MessageFeed.VirtualList.children` 改为单一逐项渲染函数，不再接受声明式 List/Footer 子元素；Footer 在同一 Root 中正常组合并 Portal 到虚拟列表末尾。外部消费者需按 Desktop 的消息列表扩展指南迁移。
- 设置侧栏标签支持 `onTabIntent`：悬停 / 聚焦时由宿主预取对应标签，与主导航 `onItemIntent` 同款。
- 自动化与批量任务页的整页入场动画改为 `initial={false}`，避免保活切回时标题从透明再淡入。
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
