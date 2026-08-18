# App Shell 主题化基座

App shell 是应用入口层，负责侧边栏、页面头部、主内容区和全局浮层的组合。它比普通页面更靠近全局状态，因此主题化需要更谨慎：先拆稳定 UI 区域，再逐步开放 region 和 component override。

当前第一个落地点是 `PageHeader`。

## 当前目录

```txt
apps/desktop/src/renderer/shared/app-shell/page-header/
  PageHeader.tsx
  PageHeaderSidebarTrigger.tsx
  PageHeaderTitle.tsx
  PageHeaderWindowActions.tsx
  types.ts
  usePageHeaderModel.ts
  index.ts

apps/desktop/src/renderer/shared/app-shell/window-controls/
  WindowControls.tsx
  WindowControlButton.tsx
  useWindowControlsModel.ts
  types.ts
  index.ts
```

## 默认组合

`App.tsx` 现在只负责传入 app shell 状态：

```tsx
<PageHeader
  sidebarCollapsed={sidebarCollapsed}
  narrow={narrow}
  onExpandSidebar={toggleSidebar}
  onOverlayOpen={openOverlay}
  onOverlayClose={scheduleOverlayClose}
/>
```

`PageHeader` 是 desktop 内部 connected 容器。它负责：

- 通过 `@vetta/theme-sdk/app-shell` 的 `usePageHeaderModel` facade 读取页面头部 model。
- 接入主题 region/component/surface。
- 在没有 region override 时，把 model 传给 `DefaultPageHeader`。

真实 `usePageHeaderModel` 实现仍在 desktop 内部，负责读取当前路由、解析默认标题、读取 page header 的 left/right/title/badge atoms、判断侧边栏触发按钮是否显示。主题不应直接 import 这个内部实现。

`DefaultPageHeader` 是 props 驱动的默认 view。它不自己取数，只消费 `PageHeaderRegionProps.model` 和传入的 actions，适合后续迁入官方 UI 包。

窗口控制同理：

- `WindowControls` 是 desktop connected 容器。
- `useWindowControlsModel` 的主题公开入口来自 `@vetta/theme-sdk/app-shell`。
- `DefaultWindowControls` 是 props 驱动 view，接收 `WindowControlsComponentProps.model`。

## Region Override

完整页面头部替换点：

```ts
regions: {
  "app.pageHeader"?: ComponentType<PageHeaderRegionProps>
}
```

`PageHeaderRegionProps` 提供：

- `model`：页面头部 view model。
- `sidebarCollapsed` / `narrow`：当前 app shell 状态。
- `onExpandSidebar` / `onOverlayOpen` / `onOverlayClose`：侧边栏展开和窄屏浮层动作。
- `className` / `classNames`：默认样式扩展。

主题可以完整替换页面头部，但不应重新实现路由标题、窗口控制或侧边栏 overlay 状态逻辑。

## Component Override

当前已接入：

```ts
components: {
  "app.pageHeaderSidebarTrigger"?: typeof PageHeaderSidebarTrigger
  "app.pageHeaderTitle"?: typeof PageHeaderTitle
  "app.pageHeaderWindowActions"?: typeof PageHeaderWindowActions
  "app.windowControls"?: ComponentType<WindowControlsComponentProps>
  "app.windowControlButton"?: typeof WindowControlButton
}
```

这些覆盖点适合只替换页面头部里的局部组件，不需要重写完整 `app.pageHeader`。

要求：

- 必须透传 `onClick`、`onMouseEnter`、`onMouseLeave`、`title` 等 DOM props。
- 必须 `forwardRef<HTMLButtonElement, PageHeaderSidebarTriggerProps>`。
- 不能吞掉 `.no-drag` 语义。如果自定义组件外层处于拖拽区域内，交互元素仍需要确保可点击。

窗口控制按钮组属于 component，不属于 region。它的粒度小于页面头部，但仍然可能被主题整体替换为自定义按钮组。单个按钮继续通过 `app.windowControlButton` 覆盖。

`DefaultWindowControls` 不把 `window.vetta.window.*` 暴露给主题。主题只能通过 `WindowControlsModel.controls[].action` 调用公开动作。

`WindowControlsModel.controls[]` 只包含窗口控制的语义数据和动作，例如 `kind`、`label`、`action`。图标 class 不属于 model，默认图标由 `WindowControlButton` 根据 `kind` 决定。主题如果替换按钮，可以完全改用自己的图标、图片或动画。

## SDK Hook 与 View

主题如果要复用官方 app-shell view，推荐在 region 中调用 SDK hook，再把 model 传入 props 驱动 view：

```tsx
import { usePageHeaderModel } from "@vetta/theme-sdk/app-shell";
import { DefaultPageHeader } from "@vetta/desktop-theme-ui/app-shell";

export function ThemePageHeader(props: PageHeaderProps) {
  const model = usePageHeaderModel(props);
  return <DefaultPageHeader {...props} model={model} />;
}
```

当前 `DefaultPageHeader` / `DefaultWindowControls` 仍位于 desktop 公开 UI 出口；后续迁入官方 UI 包时，应保持这个 props 驱动 contract，不迁移 connected 容器。

## Surface Slot

当前已定义：

```ts
type ThemeSurfaceSlot = "app.pageHeader" | "app.windowControls" | ...
```

默认 `PageHeader` 使用三层结构：

```txt
root:       drag-region / height / padding / app.pageHeader root
decoration: ThemeSurface slot="app.pageHeader"
content:    relative z-10 / left title area / right actions
```

这让主题可以给页面头部加边框、背景、纹理或 DOM 装饰，同时不影响标题和窗口控制按钮。

`WindowControls` 也提供 `app.windowControls` surface：

```txt
root:       app.windowControls root
decoration: ThemeSurface slot="app.windowControls"
content:    relative z-10 / window control buttons
```

surface slot 不是所有 component id 的镜像。`app.windowControls` 之所以登记 surface，是因为按钮组外壳有独立装饰价值；单个 `app.windowControlButton` 默认只走 component override，不额外登记 surface。

## Main Content Background

`MainContentFrame` 提供 `components["app.mainContentBackground"]`，用于给主内容 `<main>` 根区域添加装饰层。该区域包含 `PageHeader` 和 route outlet，不包含 sidebar、activity panel 或 global overlays。

这个入口适合主题基于 `useThemeRouteModel()` 给某些页面添加可读性背景、纹理或轻量遮罩。主题组件应只渲染 `pointer-events-none absolute inset-0 z-0` 一类装饰内容，真实 header 和 outlet 内容仍由宿主放在上层。

## i18n

`PageHeader` 默认标题和侧边栏触发按钮 title 使用 `common` namespace：

```txt
common.appShell.routeTitles.*
common.appShell.sidebarTrigger.*
common.appShell.windowControls.*
```

新增 app shell 文案继续放在 `common.appShell` 下。不要在 `App.tsx` 或 app shell 组件里硬编码中文。

## 与 Sidebar 的关系

`PageHeader` 不拥有侧边栏数据，也不渲染侧边栏内容。它只通过公开 action 控制：

- 宽屏：展开已收起的侧边栏。
- 窄屏：打开或延迟关闭侧边栏浮层。

侧边栏的完整 region 仍然是 `sidebar`。页面头部的 region 是 `app.pageHeader`。两者可以由同一个主题同时覆盖，但 contract 独立。

## 后续 App Shell 拆分

`RootLayout` 还可以继续拆出：

- `AppWorkspace`：根布局、外层 padding、主区域排列。
- `SidebarDock`：宽屏侧边栏停靠和动画。
- `SidebarOverlay`：窄屏侧边栏浮层和 hover close 行为。
- `MainContentFrame`：页面头部和 route outlet 的组合。
- `GlobalOverlayHost`：全局 dialog、approval、toaster、plugin slot。

不要一次性替换整个 `RootLayout`。它包含大量全局订阅和初始化逻辑，应该保持在应用数据层和 shell container 中，逐步把纯 UI 区域拆出来。
