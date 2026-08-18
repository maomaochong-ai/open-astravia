# 主题系统设计文档

本目录记录 desktop-app 主题系统的设计与实施约定。这里的主题不是单纯的颜色 token，而是面向应用 UI 的装饰、复用和替换机制。

当前主题系统分三条线演进：

- 颜色主题：已有 `apps/desktop-app/src/renderer/shared/theme/`，负责 CSS token。
- 主题协议：`packages/theme-sdk/` 负责主题模块、registry、appearance 配置和运行时上下文。
- 可选 UI 库：`packages/theme-ui/` 负责 `ThemeSurface`、`CornerImageFrame` 和通用 layout primitives 等可复用 building blocks。

## 文档索引

- [架构设计](./architecture.md)：主题系统的分层、边界和核心概念。
- [包边界与动态加载](./package-boundaries.md)：`theme-sdk`、`theme-ui`、desktop-app 和远程主题包的职责。
- [组件设计要求](./component-guidelines.md)：public primitive、override component、props contract 和 SDK 边界。
- [App Shell 主题化基座](./app-shell-foundation.md)：应用入口层和 `PageHeader` 的主题化方式。
- [侧边栏主题化基座](./sidebar-foundation.md)：当前已经落地的侧边栏 slot、`ThemeSurface`、`classNames` API。
- [浮层主题化基座](./overlay-theming.md)：root overlay、Dialog、Drawer 和审批弹层的主题化方式。
- [主题示例](./examples.md)：当前本地 demo 主题和测试方式。
- [主题自有数据存储](./storage.md)：按 themeId 隔离的本地 KV 持久化。
- [实施路线](./roadmap.md)：后续从本地配置、组件替换到远程主题包的推进顺序。

## 当前落地状态

已完成的基座：

- 侧边栏默认 UI 已按区域拆分。
- `MessageCenter`、`SettingsMenu` 等侧边栏子组件已迁入侧边栏结构。
- 新增 `@vetta/theme-sdk`，提供 `ThemeProvider`、`ThemeHostProvider`、`ThemeModule`、`useThemeRegion`、`useThemeComponent`、appearance 协议和 public model hook facade。
- 新增 `@vetta/theme-ui`，提供 `ThemeSurface`、`CornerImageFrame`、`AppFrame`、`SidebarDock`、`SidebarOverlay` 和 `MainContentFrame` 等可选 UI building blocks。
- `CornerImageFrame` 可作为 `ThemeSurface` 的 `corner-image` frame。
- 侧边栏区域已接入稳定 surface slot。
- 侧边栏入口支持 `regions.sidebar` 完整接管。
- 默认侧边栏已接入 `sidebar.navItem` 和 `sidebar.settingsTrigger` 组件覆盖点。
- 侧边栏组件支持 `className` / `classNames`，便于主题复用默认组件时做局部视觉调整。
- 新增内置 Xianxia 主题包，用于验证 appearance 和组件覆盖能力。
- `PageHeader` 已从 `App.tsx` 拆出，并接入 `app.pageHeader` region/surface 与 `app.pageHeaderSidebarTrigger` 覆盖点。
- `useSidebarModel`、`usePageHeaderModel`、`useWindowControlsModel` 已作为 SDK facade hook 暴露，真实实现由 desktop-app 通过 `ThemeHostProvider` 注入。
- Root global overlays 已开始按 connected container / props-driven view 拆分，审批、登录、文件预览、流转、更新提示等浮层已接入 view override 和 surface slot。
- 主题模块已支持声明自有页面，desktop-app 通过固定 `/theme/$themeId/$pageId` 路由承载，并支持 `content` / `main` / `app` 三档受控覆盖范围。
- 主题自有数据存储：SDK 提供 `useThemeStorage` / `useThemeStorageValue`，desktop-app host 落盘到 `~/.vetta/desktop-app/themes/<themeId>/data.json`。
- 主题 usage host：`useThemeUsageStats` 暴露 app-monitor 聚合；`ThemeModule.runtime` 可挂载无 UI 同步逻辑。xianxia 用多指标 score 映射境界，写入 theme storage key `cultivation`（与设置页 fanren 成就阶梯无关）。

当前仍未实现：

- 远程主题配置加载来源。
- 设置页里的 UI 主题选择。
- 远程主题包加载。
- 项目行、会话行、消息中心等更多细粒度组件覆盖点。
- 主题包卸载时自动清理对应 storage 目录。

## 核心原则

主题可以替换 UI 实现，但不能接管应用数据层和业务逻辑。

默认 UI 也被视为一个内置主题实现。外部主题应优先复用默认 model、actions 和 shared UI，只在必要时替换局部组件或区域。

当前侧边栏主题能力按三档生效：

```txt
Region override > Component override > Appearance config > Default UI
```

完整侧边栏接管使用 `regions.sidebar`。只替换局部组件使用 `components["sidebar.navItem"]`、`components["sidebar.settingsTrigger"]`。只做边框、背景和装饰使用 `appearance.surfaces`。

开放给主题使用的协议必须进入 `@vetta/theme-sdk`。开放给主题复用的 UI 组件不能进入 SDK，应进入 `@vetta/theme-ui`、默认主题包或具体主题包，并按公开 API 维护。组件开放前需要明确 props contract、class API、ref 透传、装饰分层和数据边界，详见 [组件设计要求](./component-guidelines.md)。

公开 UI 组件应优先保持 props 驱动。调用 SDK hook 的 connected 容器可以留在 desktop-app 里作为默认入口，但不应作为主题复用的首选组件。
