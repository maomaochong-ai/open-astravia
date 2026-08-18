# 主题组件设计要求

主题组件分两类：

- Public primitive：应用提供给主题复用的默认组件。
- Override component：主题提供给 registry 的替换组件。

两者必须使用同一份稳定 props contract。默认组件不是内部实现细节，一旦对主题开放，就需要按公开 API 管理。

## 组件开放标准

一个组件进入公共 UI 库或主题公开导出前，需要满足这些条件：

- 行为边界清楚：组件只负责渲染和局部交互，不直接拥有跨领域业务流程。
- props 稳定：主题能通过 props 获取渲染所需数据和动作。
- 不依赖内部 store：不能要求主题 import Jotai atom、router、IPC 或 domain 私有 hook。
- 样式可组合：支持 `className`，复合组件支持 `classNames`。
- ref 可透传：需要作为 trigger、button、row、focus target 的组件必须 `forwardRef`。
- 文案可控：用户可见文案必须走 i18n，不能在主题组件中硬编码中文。
- 装饰分层清楚：需要主题装饰的区域必须提供 root / decoration / content 三层。
- 默认行为可回退：主题未提供 override 时，默认组件行为不变。

不适合立即开放的组件：

- props 依赖大量内部临时状态。
- 组件内部直接调用 IPC 或 router。
- 组件承担多个不相关职责。
- 组件的 DOM 结构仍频繁变化，无法承诺兼容。

## Props Contract

主题组件 props 应该表达 UI contract，而不是内部实现细节。

推荐：

```ts
export interface SidebarNavItemButtonProps
  extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
  item: SidebarNavItem;
  classNames?: {
    badge?: string;
    icon?: string;
    label?: string;
  };
}
```

要求：

- 继承合适的 DOM props，保留 `onClick`、`disabled`、`title`、aria 等能力。
- 不暴露 `setState`、atom setter、router navigate 等内部对象。
- action 用语义函数表达，例如 `onOpenSession`、`onItemClick`。
- 数据对象用 view model 类型表达，例如 `SidebarNavItem`、`SettingsMenuModel`。
- 数据对象不要携带 UI-only 字段，例如图标 class、图片 URL、布局 class 或动画参数。除非这些字段本身来自业务数据，而不是默认 UI 的表达方式。
- 用户可见 label、aria-label、title 等语义文案可以由 model 提供，并应在 model hook 或数据层完成 i18n 解析。
- 回调返回值要明确；异步 action 使用 `Promise<void>`。
- 可选 props 必须有清晰默认行为。

避免：

```ts
interface BadProps {
  atom: PrimitiveAtom<State>;
  navigate: NavigateFn;
  ipc: typeof window.vetta;
  rawProject: InternalProjectRecord;
  icon: "icon-[mdi--close]";
  rowClassName: "px-2";
}
```

## Region Props

Region 是完整区域接管点。它的 props 应该提供组合所需的 model、actions 和 classNames。

当前侧边栏：

```ts
export interface SidebarRegionProps {
  classNames?: SidebarClassNames;
  model: SidebarModel;
  onOpenSession: SidebarProps["onOpenSession"];
}
```

Region 组件可以：

- 自由新增主题自己的 UI。
- 重排默认组件。
- 复用 `@vetta/theme-ui` 或桌面端公开 UI 出口中的 public primitives。
- 使用 `ThemeSurface` 接入装饰层。

Region 组件不应该：

- 重新实现业务数据加载。
- 直接访问内部 store、IPC、router。
- 复制默认组件中的业务流程。

## Override Component

Override component 用于替换默认 UI 中的局部组件。

当前已接入：

```ts
components: {
  "app.pageHeaderSidebarTrigger"?: typeof PageHeaderSidebarTrigger;
  "app.pageHeaderTitle"?: typeof PageHeaderTitle;
  "app.pageHeaderWindowActions"?: typeof PageHeaderWindowActions;
  "app.windowControls"?: ComponentType<WindowControlsComponentProps>;
  "app.windowControlButton"?: typeof WindowControlButton;
  "sidebar.navigation"?: ComponentType<SidebarNavigationProps>;
  "sidebar.navItem"?: typeof SidebarNavItemButton;
  "sidebar.settingsTrigger"?: typeof SettingsMenuTrigger;
}
```

设计要求：

- props 必须与 fallback 组件兼容。
- 需要 trigger 行为时必须转发 ref 和透传 props。
- 新增 override id 必须登记到 `ThemeComponentRegistry`，不能只在文档或调用点写字符串。
- 不要吞掉默认组件传入的 `onClick`、`aria-*`、`data-*`。
- 不要假设父组件 DOM 结构，除非 contract 明确说明。
- 不要引入会改变列表测量的不可控布局副作用。

示例：

```tsx
const CustomNavItem = forwardRef<HTMLButtonElement, SidebarNavItemButtonProps>(
  function CustomNavItem({ className, ...props }, ref) {
    return (
      <SidebarNavItemButton
        ref={ref}
        className={cn("rounded-lg border border-border/50", className)}
        {...props}
      />
    );
  },
);
```

## Class API

`className` / `classNames` 是默认组件复用的最低成本扩展点。

规则：

- 简单组件使用 `className`。
- 复合组件使用 `classNames` 标记内部稳定区域。
- `classNames` key 需要语义化，例如 `icon`、`label`、`toolbar`、`list`。
- 不为临时 DOM 细节开放 class key。
- class 应该合并到合适层级，不能破坏布局基础约束。

class API 适合：

- 调整间距。
- 调整边框、圆角、背景透明度。
- 调整图标和文本局部样式。

class API 不适合：

- 改变组件行为。
- 插入新 DOM。
- 重排区域。
- 替换复杂交互。

这些场景应该使用 component override 或 region override。

## 装饰分层

可主题化组件需要遵守三层结构：

```txt
root
  decoration: ThemeSurface
  content
```

要求：

- root 承载尺寸、定位、圆角、基础背景、基础边框。
- decoration 默认 `absolute inset-0 z-0 pointer-events-none overflow-visible`。
- content 默认 `relative z-10`，背景透明，只负责真实 UI、布局和必要裁剪。
- content 不要设置不透明背景，否则会遮挡 decoration。
- 图片边框和外扩装饰不应参与布局。

### Dialog / Drawer

Dialog 和 Drawer 的根层通常由基础 UI 组件提供 `fixed` 定位。主题化 view 不能用 `relative` 覆盖这个定位，否则弹层会脱离原本的居中或贴边布局。

要求：

- `DialogContent` / `DrawerContent` 根层不要添加会覆盖基础定位的 `relative`。
- 根层使用 `overflow-visible`，允许图片边框和外扩装饰显示。
- `ThemeSurface` 放在根层直接子级。
- 滚动和裁剪放到内部 content 层，例如 `relative z-10 max-h-[90vh] overflow-y-auto rounded-[inherit]`。
- 标题、正文、footer 可以都在 content 层内，但滚动区域应按真实交互需要拆分，避免标题或 footer 被错误纳入滚动。

推荐：

```tsx
<DialogContent className="overflow-visible p-0">
  <ThemeSurface slot="root.someDialog.panel" />
  <div className="relative z-10 max-h-[90vh] overflow-y-auto rounded-[inherit]">
    <Header />
    <Body />
    <Footer />
  </div>
</DialogContent>
```

避免：

```tsx
<DialogContent className="relative overflow-hidden">
```

这个写法会同时破坏基础定位并裁掉外扩装饰。

## SDK 与 UI 包边界

Theme SDK 是主题唯一应依赖的应用协议 API。它不承载具体 UI 实现。

`@vetta/theme-sdk` 可以导出：

- 主题模块、registry、appearance 配置类型。
- provider、resolver hook 和 host bridge。
- public model hook 的 facade 类型和 hook 入口。
- region/component props contract。

`@vetta/theme-sdk` 不导出：

- 默认 UI 组件。
- 具体主题组件。
- `ThemeSurface`、`CornerImageFrame` 这类视觉实现。
- 访问 Jotai、router、IPC 的真实 hook 实现。
- Jotai atom。
- router 实例。
- `window.vetta.*`。
- domain 私有 hook。
- 仍在重构中的内部组件。

`@vetta/theme-ui` 可以导出：

- `ThemeSurface`。
- `CornerImageFrame`。
- 通用装饰组件。
- 不绑定应用内部数据的布局 primitive。
- 接收 `model` / `actions` props 的官方默认 view 组件。

desktop 可以额外提供窄口径的官方 UI primitive 出口，例如 `@vetta/desktop-theme-ui/sidebar`。这类出口只应导出稳定的 props-driven 子组件和类型，例如 `SidebarNavigation`、`SidebarNavItemButton`、`SidebarNavigationProps`、`SidebarNavItem`；不要从该出口导出完整 sidebar connected container 或会牵出整个领域依赖树的组件。

具体主题组件应放在主题包内。新增主题不应修改 SDK；只有协议、registry、host 能力变化时才修改 SDK。

UI 包导出组件时，要同步导出 props 类型。主题作者不应该通过 `ComponentProps<typeof X>` 猜 props。

公开给主题复用的官方 UI 组件应优先使用 props 驱动：

```tsx
<DefaultSidebar model={model} onOpenSession={onOpenSession} />
<DefaultPageHeader model={model} {...pageHeaderProps} />
<DefaultWindowControls model={model} />
```

不推荐把内部调用 `useSidebarModel()`、`usePageHeaderModel()` 这类 SDK model hook 的 connected 容器作为公共 UI 组件暴露。connected 容器可以留在 desktop 内部，用于默认应用入口；主题复用的组件应接收调用方传入的 model。

### Public Model Hooks

主题使用的 hook 应从 SDK 导入：

```ts
import { useSidebarModel } from "@vetta/theme-sdk/sidebar";
import { usePageHeaderModel } from "@vetta/theme-sdk/app-shell";
```

这些 hook 是 facade。它们只读取 `ThemeHostProvider` 中应用注入的能力，并返回稳定 model。真实实现仍留在 desktop，可以访问内部 store、router 和 IPC，但这些细节不能穿透到主题包。

主题如果要复用官方 UI，推荐在主题 region 中先调用 SDK hook，再把 model 作为 props 传给官方 view：

```tsx
import { useSidebarModel } from "@vetta/theme-sdk/sidebar";
import { DefaultSidebar } from "@vetta/desktop-theme-ui/sidebar";

export function ThemeSidebar(props: SidebarProps) {
  const model = useSidebarModel(props);
  return <DefaultSidebar model={model} onOpenSession={props.onOpenSession} />;
}
```

这样 hook 入口属于 SDK，UI 组件仍保持 props 驱动。

如果只需要调整某个父组件的数据组合，不必替换完整 region。例如主题要把自己的页面插入侧边栏导航，可以替换 `sidebar.navigation`，在替代组件中调用 `useThemePagesModel()` 取得主题页导航数据，再复用 `SidebarNavigation` 渲染合并后的 items。这样既不污染 `useSidebarModel()`，也不要求主题重写整个 `DefaultSidebar`。

新增 public model hook 时需要同时定义：

- hook input 类型。
- model 返回类型。
- host capability 类型。
- desktop host adapter。
- 文档中的数据/UI 边界说明。

## 命名约定

Region id：

```txt
sidebar
chatPage
settingsPage
```

Component id：

```txt
app.pageHeaderSidebarTrigger
app.pageHeaderTitle
app.pageHeaderWindowActions
app.windowControls
app.windowControlButton
sidebar.navItem
sidebar.settingsTrigger
sidebar.projectRow
sidebar.sessionRow
chat.messageBubble
chat.inputAction
```

Surface slot：

```txt
app.pageHeader
app.windowControls
sidebar.panel
sidebar.projects
chat.messageList
chat.inputBar
```

命名原则：

- region 使用大区域名。
- component 使用领域 + 组件语义。
- surface 使用领域 + 可装饰区域。
- surface 不是 component id 清单。只有组件提供 root / decoration / content，且确实需要低代码装饰能力时，才登记 surface slot。
- 不把实现细节写进 id，例如 `leftButtonV2`。

## 验收清单

开放一个新主题组件前，至少确认：

- 默认 UI 在未配置主题时行为不变。
- override 组件可以只替换该组件，不需要重写父级。
- 完整 region 可以复用该组件。
- props 不暴露内部 store、IPC、router。
- ref 和 DOM props 透传正确。
- `className` / `classNames` 生效。
- 用户可见文案走 i18n。
- `bun run check` 通过。
- desktop 修改后 `bunx tsc --noEmit` 通过。
