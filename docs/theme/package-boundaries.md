# 主题包边界与动态加载

## 包职责

主题系统拆成四个边界。

```txt
@vetta/theme-sdk
  协议、类型、registry、provider、resolver hook、host bridge

@vetta/theme-ui
  可选 UI building blocks，例如 ThemeSurface、CornerImageFrame、layout primitives

desktop
  应用数据、动作、默认主题、主题加载器、registry 类型扩展

packages/themes/builtin
  随应用构建的内置主题包

packages/themes/remote
  远程主题开发边界，不属于 desktop 构建输入
```

## Theme SDK

`@vetta/theme-sdk` 只表达主题如何接入应用，不表达具体视觉。

可以放入 SDK：

- `ThemeModule`、`ThemeMeta`。
- `ThemeRegionRegistry`、`ThemeComponentRegistry`、`ThemeSurfaceRegistry`。
- `ThemeProvider`、`useThemeRegion`、`useThemeComponent`。
- 主题页面声明类型和受控 layout 协议。
- `ThemeAppearance` 和 frame 配置协议。
- `ThemeHostProvider`、host bridge 和 public model hook facade。
- `useSidebarModel`、`usePageHeaderModel`、`useWindowControlsModel` 这类主题可用 hook 入口。
- `useThemeStorage`、`useThemeStorageValue` 与 `ThemeStorage` 协议（主题自有 KV 存储 facade）。

不放入 SDK：

- 默认侧边栏 UI。
- 默认标题栏 UI。
- 具体主题组件。
- 装饰组件实现。
- 访问 Jotai、router、IPC 的真实 hook 实现。
- 图标、图片、动画和 CSS class 方案。
- 主题 storage 的文件落盘与 IPC 实现（属于 desktop host）。

新增主题不应该修改 SDK。只有新增协议能力、公开 model、registry id 或 host capability 时，才修改 SDK。

SDK hook 是 facade，不是数据层实现。例如：

```ts
import { useSidebarModel } from "@vetta/theme-sdk/sidebar";
```

这个 hook 从 `ThemeHostProvider` 读取 desktop 注入的实现。主题只能看到稳定 model 和 actions，不能接触内部 atom、router 或 `window.vetta`。

## Theme UI

`@vetta/theme-ui` 是可选 UI 库，不是主题协议的一部分。

它可以提供：

- `ThemeSurface`。
- `CornerImageFrame`。
- 通用装饰组件。
- 不依赖 desktop 内部 store、router、IPC 的布局 primitive。
- 接收 `model` / `actions` props 的官方默认 view 组件。

当前已提供的 layout primitives：

- `AppFrame`
- `SidebarDock`
- `SidebarOverlay`
- `MainContentFrame`

主题可以复用 `@vetta/theme-ui`，也可以完全不用它。`@vetta/theme-ui` 不能成为所有主题实现的集合；具体主题组件应留在具体主题包里。

官方 UI 组件应保持 props 驱动。调用 SDK model hook 的 connected 容器可以存在于 desktop 内部，但不应作为主题复用的首选组件导出。

## Desktop App

desktop 负责把应用能力接到主题系统。

职责：

- 提供真实数据和 actions。
- 通过 `ThemeHostProvider` 注入 SDK hook 的真实实现。
- 提供默认主题实现。
- 提供主题加载器。
- 通过 TypeScript module augmentation 声明本应用支持的 region/component/surface id。
- 在运行时把 `react`、`@vetta/theme-sdk` 和可选 `@vetta/theme-ui` 作为 shared singleton 暴露给远程主题。

desktop 不应该要求主题 import 内部路径，例如 `@shared/*`、`@domains/*` 或 `window.vetta.*`。

## 主题目录

具体主题按来源分为两个目录：

```txt
packages/themes/
  builtin/
    xianxia/
  remote/
```

`builtin` 中的主题可以参与 monorepo 的依赖安装和类型检查，但不属于 desktop 的依赖或 Vite 构建输入，也不被 desktop 静态导入。`build:themes` 独立构建主题归档，开发时解压到 `.artifacts/system-themes`，发布时解压到 `Resources/system-themes`。主进程启动后扫描主题目录并通过 preload 下发描述信息。

`remote` 目录同样不属于 desktop 构建输入。远程主题由主题商店安装到用户主题目录后，被同一个扫描与加载流程发现。

两类主题使用相同的 manifest、构建产物、`ThemeModule` 和 Module Federation 加载器。差异只在来源目录：内置主题来自只读应用资源，远程主题来自用户主题目录。

## 远程主题包

主题包未来不通过 npm 安装到应用内。npm 包名只表示开发期和构建期的依赖契约。

运行时流程应是：

1. 应用读取主题 manifest。
2. 校验主题 id、版本、SDK 版本和能力声明。
3. 动态加载主题 bundle。
4. 将 `react`、`react-dom`、`@vetta/theme-sdk` 和可选 `@vetta/theme-ui` 映射为应用内置 singleton。
5. 渲染主题提供的 `ThemeModule`。
6. 加载失败时回退默认主题。

新增 SDK 子路径导出时，desktop runtime shared 配置和主题包 federation shared 配置必须同步登记对应子路径，例如 `@vetta/theme-sdk/routing`。否则主题包可能加载到另一份 SDK 实例，导致 `ThemeProvider` 或 `ThemeHostProvider` context 读取失败。主题组件优先从 `@vetta/theme-sdk` 根入口导入已 re-export 的 hook；只有需要子路径边界时才使用子路径导入。

主题包可以包含：

- `appearance` 配置。
- component override。
- region override。
- theme page。
- 主题自己的资源、动画、DOM 效果、视频背景。
- 主题自己的 i18n 资源。

主题包不应该包含：

- 自己打包的一份 React。
- 自己打包的一份 `@vetta/theme-sdk`。
- 直接访问应用内部 store/IPC/router 的代码。

## 当前状态

当前已落地：

- `packages/theme-sdk`：主题协议和运行时上下文。
- `packages/theme-ui`：`ThemeSurface`、`CornerImageFrame` 和基础 layout primitives。
- desktop：通过 `apps/desktop/src/renderer/shared/theme/registry.ts` 声明当前支持的 region/component/surface id。
- `packages/themes/builtin/xianxia`：第一个独立内置主题包。
- desktop：主进程扫描内置/远程主题目录，renderer 通过统一 runtime loader 恢复已选择主题并在失败时回退默认主题。

当前仍保留在 desktop：

- 默认 sidebar/app-shell 组件。
- `apps/desktop/src/renderer/shared/theme/sdk/` 作为桌面端公开 UI 导出桶。

后续如果要让默认 UI 组件被远程主题稳定复用，应把 props 驱动的 view 迁入独立默认主题 UI 包或更明确的 desktop theme UI 包，而不是放进 `@vetta/theme-sdk`。connected 容器继续留在 desktop。
