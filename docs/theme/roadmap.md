# 主题系统实施路线

主题系统需要按低风险路径推进。先让默认 UI 可复用，再接入配置化装饰，最后再做远程组件替换。

## 阶段 1：默认 UI 可复用

状态：进行中，侧边栏已完成第一轮。

目标：

- 默认 UI 拆成稳定区域。
- 行为进入 model hook。
- 组件支持 `className` / `classNames`。
- 关键区域接入 `ThemeSurface`。
- 默认视觉保持不变。

已落地点：

- `PageHeader`
- `Sidebar`
- `DefaultSidebar`
- `SidebarPanel`
- `SidebarTopBar`
- `SidebarNavigation`
- `SidebarProjectsSection`
- `SidebarBottomBar`
- `settings-menu`
- `message-center`

下一步可继续细化：

- `ProjectRow`
- `SessionRow`
- `AddProjectMenuTrigger`
- `SettingsMenuPopover`
- `MessageCenterDialog`

## 阶段 2：本地 appearance 配置

状态：基础协议已拆到 `packages/theme-sdk`，装饰和应用 UI 已拆到 `packages/theme-ui`，Xianxia 已作为独立内置主题包接入。

目标：

- 定义本地 `ThemeAppearance` 注册入口。
- 支持开发期注入 surface 配置。
- 支持 `corner-image` frame 的真实素材验证。
- 支持按主题 ID 选择 appearance。

当前静态主题目录：

```txt
packages/themes/
  builtin/
    xianxia/
  remote/
```

desktop 主进程扫描 staging、应用 Resources 和用户主题目录，renderer 通过 `shared/theme/runtime` 的 provider 与 Module Federation loader 选择主题。desktop 不静态依赖任何具体主题包。

暂时不做：

- 远程加载。
- manifest 校验。
- 权限系统。

## 阶段 3：更多装饰 frame

当前只支持：

```ts
{ kind: "corner-image" }
```

后续可以增加：

```ts
{ kind: "background-image" }
{ kind: "video-background" }
{ kind: "dom-effect" }
```

注意边界：

- frame 只负责视觉。
- 不执行业务动作。
- 不能破坏布局和可访问性。
- 不能吞掉交互事件。

## 阶段 4：Component Override Registry

状态：侧边栏最小闭环已开始。

目标：

- 默认组件通过 registry 解析可替换实现。
- 主题可以只替换一个组件。
- 未配置或加载失败时回退默认组件。

示意：

```tsx
const NavItemButton = resolveThemeComponent(
  "sidebar.navItemButton",
  SidebarNavItemButton,
);
```

第一批适合开放的组件：

- `SidebarNavItemButton`：已接入 `sidebar.navItem`
- `SettingsMenuTrigger`：已接入 `sidebar.settingsTrigger`
- `ProjectRow`
- `SessionRow`
- `MessageCenterTrigger`

不要一开始开放所有组件。先开放 props 稳定、行为边界清楚的组件。

## 阶段 5：Region Override

状态：侧边栏最小闭环已开始。

目标：

- 支持替换完整区域。
- 主题可以替换 `DefaultSidebar`，但继续复用 `SidebarModel`。

示意：

```tsx
const SidebarRenderer = resolveThemeRegion("sidebar", DefaultSidebar);
return <SidebarRenderer model={model} onOpenSession={props.onOpenSession} />;
```

第一批 region：

- `app.pageHeader`：已接入 `regions["app.pageHeader"]`
- `sidebar`：已接入 `regions.sidebar`
- `chatPage`
- `settingsPage`

## 阶段 5.5：Theme Page

状态：最小闭环已接入。

目标：

- 主题可以声明自己的独立页面。
- desktop 通过固定 `/theme/$themeId/$pageId` 路由承载页面，不允许主题动态注入任意路由。
- 主题页支持 `content` / `main` / `app` 三档受控覆盖范围。
- 主题页导航数据通过 `useThemePagesModel()` 暴露。主题可以替换 `sidebar.navigation`，复用公开的 `SidebarNavigation` / `SidebarNavItemButton`，把默认导航项和主题页导航项合并渲染。

暂不做：

- 主题替换宿主已有页面路径。
- 主题自定义任意 route path。
- 主题接管全局浮层、router 或 IPC。

## 阶段 5.6：Theme Storage

状态：基础设施已接入。

目标：

- 主题可通过 SDK 读写自己的本地 KV 数据。
- Host 强制按 `themeId` 隔离；落盘在 main 进程。
- 配额、key 校验、多窗口广播。

已落地点：

- `@vetta/theme-sdk/storage`：`useThemeStorage`、`useThemeStorageValue`。
- desktop host + preload IPC + `~/.vetta/desktop-app/themes/<themeId>/data.json`。

暂不做：

- 主题包卸载时自动清理 storage。
- 二进制 / 大文件。
- 云同步与加密。

## 阶段 6：远程主题包

远程主题包应在本地 API 稳定后再接入。

主题包未来不是通过 npm 安装进应用，而是在应用运行时动态加载。主题作者可以在开发期依赖 `@vetta/theme-sdk` 的类型和 `@vetta/theme-ui` 的可选组件；运行时由应用主题加载器提供这些 shared singleton。

主题包需要 manifest：

```ts
interface ThemePackageManifest {
  id: string;
  name: string;
  version: string;
  sdkVersion: string;
  appearance?: string;
  components?: Record<string, string>;
  regions?: Record<string, string>;
}
```

运行时要求：

- React 单例共享。
- `@vetta/theme-sdk` 单例共享。
- 可选 `@vetta/theme-ui` 单例共享。
- SDK 版本检查。
- ErrorBoundary。
- 加载失败回退默认 UI。
- i18n 资源边界。
- 权限声明。

## 阶段 7：官方默认 UI 组件迁入 theme-ui

状态：基础 layout primitives 已开始迁入。

目标：

- 把已经稳定的 props-driven view 迁入官方 UI 包。
- 不迁移 connected container。
- 不迁移真实 model hook 实现。
- 保持 `model` / `actions` / `className` / `classNames` contract 稳定。

第一批候选：

- `AppFrame`：已迁入
- `SidebarDock`：已迁入
- `SidebarOverlay`：已迁入
- `MainContentFrame`：已迁入
- `DefaultPageHeader`
- `PageHeaderSidebarTrigger`
- `PageHeaderTitle`
- `PageHeaderWindowActions`
- `DefaultWindowControls`
- `WindowControlButton`
- `SidebarPanel`
- `SidebarNavigation`
- `SidebarNavItemButton`

暂缓迁移：

- `Sidebar`
- `PageHeader`
- `WindowControls`
- `ProjectsPanel`
- `SettingsMenu`
- `MessageCenter`

复杂组件应先拆成：

```txt
useXxxModel   -> desktop
XxxView       -> theme-ui / official UI package
XxxContainer  -> desktop
```

## 阶段 8：聊天页主题化

侧边栏稳定后，再把同样模式应用到聊天页。

建议拆分：

```txt
ChatPage
  ChatLayout
  MessageList
  MessageBubble
  ToolCallBlock
  InputBar
  ComposerActions
```

优先 surface：

- `app.pageHeader`：已接入
- `chat.page`
- `chat.messageList`
- `chat.messageBubble`
- `chat.inputBar`

优先 override：

- `MessageBubble`
- `ToolCallBlock`
- `InputBarButton`

## 验收标准

每一阶段都要满足：

- 默认 UI 行为不变。
- `bun run check` 通过。
- desktop 修改后 `bunx tsc --noEmit` 通过。
- 新增用户可见文案走 i18n。
- 不让主题直接访问内部 store / IPC。
- 加载失败能回退默认 UI。
- 新开放的主题组件符合 [组件设计要求](./component-guidelines.md)。

## 当前优先级

近期建议顺序：

1. 继续迁移第一批 props-driven app-shell/sidebar 组件到官方 UI 包。
2. 继续拆 `App.tsx` 中剩余纯 UI 壳层和业务浮层宿主。
3. 把当前内置主题 runtime 接入设置页 UI 主题选择。
4. 补 `ProjectRow`、`SessionRow` 的 public props，并接入 component override。
5. 把 `settingsMenu`、`messageCenter` 弹层接入 `ThemeSurface`。
6. 增加主题组件 ErrorBoundary。
7. 再接远程主题包加载。
