# 侧边栏主题化基座

侧边栏是当前主题系统的第一个落地点。它既是默认 UI，也是未来主题复用和替换的 shared UI。

## 当前目录

```txt
apps/desktop/src/renderer/domains/project/components/sidebar/
  Sidebar.tsx
  DefaultSidebar.tsx
  SidebarPanel.tsx
  SidebarTopBar.tsx
  SidebarNavigation.tsx
  SidebarNavItemButton.tsx
  SidebarProjectsSection.tsx
  SidebarBottomBar.tsx
  types.ts
  useSidebarModel.ts

  add-project/
  filters/
  message-center/
  projects/
  settings-menu/
  update/
```

## 默认组合

当前入口仍然很薄：

```tsx
export function Sidebar(props: SidebarProps): JSX.Element {
  const model = useSidebarModel(props);
  const ThemeSidebar = useThemeRegion("sidebar");
  if (ThemeSidebar) {
    return (
      <ThemeSidebar
        classNames={props.classNames}
        model={model}
        onOpenSession={props.onOpenSession}
      />
    );
  }
  return (
    <DefaultSidebar
      classNames={props.classNames}
      model={model}
      onOpenSession={props.onOpenSession}
    />
  );
}
```

这个结构保证：

- `Sidebar` 是 desktop 内部 connected 容器。
- 主题公开的 `useSidebarModel` 入口来自 `@vetta/theme-sdk/sidebar`。
- 真实 `useSidebarModel` 实现仍在 desktop 内部，并通过 `ThemeHostProvider` 注入。
- `DefaultSidebar` 是 props 驱动 view，接收 `SidebarModel` 和 actions。
- 主题可以复用默认 UI，也可以通过 `regions.sidebar` 替换完整侧边栏。

## Region Override

完整侧边栏替换点：

```ts
regions: {
  sidebar?: ComponentType<SidebarRegionProps>
}
```

`SidebarRegionProps` 提供：

- `model`：侧边栏 view model 和 actions。
- `onOpenSession`：打开会话的公开动作。
- `classNames`：调用方传入的默认样式扩展。

主题实现完整侧边栏时，可以自由新增组件和调整布局，同时复用公开 UI 出口或官方 UI 包中的默认 view 组件。

侧边栏 region 不负责直接访问内部 store、router 或 IPC。它可以使用 `SidebarRegionProps.model` 中的状态和 actions；如果主题自己组合完整 region，也可以调用 `@vetta/theme-sdk/sidebar` 暴露的 `useSidebarModel` facade，再把 model 作为 props 传给 props 驱动 view。

示意：

```tsx
import { useSidebarModel } from "@vetta/theme-sdk/sidebar";
import { DefaultSidebar } from "@vetta/desktop-theme-ui/sidebar";

export function ThemeSidebar(props: SidebarProps) {
  const model = useSidebarModel(props);
  return <DefaultSidebar model={model} onOpenSession={props.onOpenSession} />;
}
```

## Component Override

默认侧边栏当前已接入两个细粒度替换点：

```ts
components: {
  "sidebar.navItem"?: typeof SidebarNavItemButton
  "sidebar.settingsTrigger"?: typeof SettingsMenuTrigger
}
```

这类替换适合只换一个局部组件，不需要重写完整 `regions.sidebar`。

Override 组件必须兼容默认组件 props。`sidebar.navItem` 要保留 ref、`onClick`、DOM props 和 `classNames`；`sidebar.settingsTrigger` 要保留 ref 和 PopoverTrigger 注入的 props，否则会破坏弹层打开行为。

## Surface Slot

当前已定义的侧边栏 surface slot：

```ts
type ThemeSurfaceSlot =
  | "sidebar.panel"
  | "sidebar.topBar"
  | "sidebar.navigation"
  | "sidebar.projects"
  | "sidebar.bottomBar"
  | "sidebar.settingsMenu"
  | "sidebar.messageCenter";
```

已接入默认侧边栏结构的 slot：

- `sidebar.panel`
- `sidebar.topBar`
- `sidebar.navigation`
- `sidebar.projects`
- `sidebar.bottomBar`

`sidebar.settingsMenu` 和 `sidebar.messageCenter` 已预留，适合后续给弹层接入 frame、背景或外壳装饰。

## ThemeSurface

实现位置：

```txt
packages/theme-ui/src/appearance/ThemeSurface.tsx
```

职责：

- 根据 `slot` 读取当前 appearance 配置。
- 没有配置时渲染空的装饰层。
- 配置 `corner-image` 时渲染角图装饰。
- 给 DOM 保留 `data-theme-surface`，便于调试和后续装饰引擎挂载。

低定制主题只需要配置 surface，不需要写组件。

`ThemeSurface` 只负责装饰层，不负责包裹业务内容。可主题化组件本身提供三层结构：

```txt
Root
  size / position / radius / base background / base border

  ThemeSurface decoration layer

  Content layer
    real UI / layout / overflow clipping
```

这样图片边框、背景和特效不会参与布局，也不会被内容层的 `overflow-hidden` 裁剪。

### 层级与背景约束

侧边栏可主题化区域必须遵守固定层级：

```txt
root:       relative，承载尺寸、定位、圆角、基础背景、基础边框
decoration: absolute inset-0 z-0 pointer-events-none overflow-visible
content:    relative z-10，默认透明，只负责真实 UI、布局和必要裁剪
```

背景不能默认设置在 content 层。原因是 content 层在 decoration 层之上，如果 content 层有不透明背景，会把装饰层完全盖住。

需要基础面板背景时，放在 root 层。需要裁剪内容时，放在 content 层。需要图片边框、角图、纹理、DOM 特效时，放在 decoration 层。

装饰层默认不能遮挡内容，也不能接收交互事件。只有明确的 overlay 装饰才允许通过主题配置提升层级，但需要单独评估遮挡和可点击区域。

## CornerImageFrame

实现位置：

```txt
packages/theme-ui/src/appearance/CornerImageFrame.tsx
```

当前已支持：

- `className`
- `contentClassName`
- `decoration`
- `imageUrl`
- 普通 `div` props 透传

它不应该绑定侧边栏业务，只是通用装饰容器。

## SidebarClassNames

为了让默认侧边栏组件可以被主题复用，`SidebarProps` 已支持 `classNames`：

```ts
export interface SidebarClassNames {
  bottomBar?: string;
  bottomBarSettings?: string;
  navigation?: string;
  navIndicator?: string;
  navItem?: string;
  navItemBadge?: string;
  navItemIcon?: string;
  navItemLabel?: string;
  panel?: string;
  panelContent?: string;
  projects?: string;
  projectsList?: string;
  projectsToolbar?: string;
  topBar?: string;
  topBarActions?: string;
  topBarBrand?: string;
  topBarClawButton?: string;
  topBarCollapseButton?: string;
}
```

使用示例：

```tsx
<Sidebar
  onOpenSession={openSession}
  classNames={{
    panel: "border-primary/40",
    projectsToolbar: "px-3",
    navItem: "rounded-lg"
  }}
/>
```

`classNames` 是低成本复用默认组件的能力。它不能替代组件 override，但能覆盖大量“不想重写组件，只想调整局部样式”的主题需求。

## 组件分区

当前默认侧边栏分为：

```txt
SidebarPanel
  外壳、resize、sidebar.panel surface

SidebarTopBar
  品牌区、更新按钮、Claw 状态、折叠按钮

SidebarNavigation
  导航区、选中指示器、导航按钮

SidebarProjectsSection
  过滤器、新建项目、项目列表容器

SidebarBottomBar
  设置菜单、消息中心入口
```

子目录职责：

```txt
add-project/
  新建项目菜单

filters/
  侧边栏过滤器

message-center/
  消息中心触发器、弹层、tab、列表

projects/
  项目组、项目行、会话行

projects/panel/
  项目面板 model、默认会话、右键菜单

settings-menu/
  设置菜单触发器、弹层、主题、额度、账号、下载入口

update/
  侧边栏更新按钮
```

## 设计约定

新增侧边栏通用组件时：

- 简单组件提供 `className`。
- 复合组件提供 `classNames`。
- 需要进入公共 UI 库或桌面端公开 UI 出口的组件必须导出 props 类型。
- 需要作为 trigger、button、row、focus target 的组件必须 `forwardRef`。
- props 不暴露 atom、router、IPC 或 domain 私有 hook。
- actions 用语义回调表达，不把内部实现对象交给主题。
- 需要被主题装饰的区域由组件提供 root / decoration / content 层，`ThemeSurface` 只放在 decoration 层。
- root 层承载尺寸、定位、圆角、基础背景和基础边框。
- decoration 层默认 `absolute inset-0 z-0 pointer-events-none overflow-visible`。
- content 层默认 `relative z-10`，不要设置不透明背景，只负责布局和必要的 `overflow-hidden`。
- 行为放进 model hook。
- UI 组件只通过 props 使用数据和 actions。
- connected 容器可以调用 SDK hook，但公开给主题复用的 view 必须 props 驱动。
- 用户可见文案必须走 i18n。
- 不保留无意义 re-export 兼容壳。

## 当前限制

当前基座还没有：

- 从配置文件加载 appearance。
- 从远程主题包加载组件。
- 对项目行、会话行、消息气泡等细粒度组件的统一 override contract。

这些能力应在当前 slot 和 classNames 基础上继续演进。
