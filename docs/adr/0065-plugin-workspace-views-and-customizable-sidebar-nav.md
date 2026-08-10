# ADR-0065: 插件工作区视图与可自定义的侧边栏导航

## 状态

Accepted

## 背景

在此之前，插件能贡献的 UI 全部**依附于某个宿主容器**：全局浮层挂在 App 根部、文件预览挂在预览壳里、活动 Tab 与 Turn 卡挂在会话页。这套划分对「辅助当前对话」的扩展是合适的，但对**跨会话、跨项目的工作台**（看板、控制台、仪表盘）不成立——把一个总览面板绑在某一次对话上，语义就是错的：用户切走会话它就没了，而它本来要回答的问题恰恰是「我这些会话现在都在干什么」。

同时，宿主侧边栏的导航是硬编码的：常驻四项写死在 `useSidebarModel` 的 `PRIMARY_NAV_ITEMS`，其余写死在 `MORE_NAV_ITEMS`。插件即便能贡献整页 UI，也没有稳定的入口可以出现在导航里；而用户也无法按自己的使用频率调整这些入口。

主题（Theme）侧已有一个可参照的先例：`ThemePageDefinition` + `/theme/$themeId/$pageId` 路由。它证明了「扩展方拥有整页、宿主只提供路由与兜底」这条路在本仓库是走得通的。

## 决策

### 1. 新增插件插槽「工作区视图」（Workspace View）

- SDK 契约 `PluginWorkspaceViewContribution`，注册入口 `ctx.ui.registerWorkspaceView()`，程序化跳转 `ctx.ui.openWorkspaceView(viewId)`。
- 新权限 `ui.slot.workspace-view`，风险等级 **medium**：它同时拿到整页内容区和一个侧边栏常驻入口，可见性显著高于面板内插槽，故不与 `ui.slot.global`（low）同级。
- 宿主路由 `/workspace/$pluginId/$viewId`，与主题页同构。视图 id 进 URL 且参与侧边栏布局持久化，因此限定为 `^[a-z0-9][a-z0-9._-]*$`。
- `icon` 是 **iconify class 字符串**而非 ReactNode。其余插槽的 icon 都是 ReactNode，这里刻意不同：宿主要把它渲染进自己的导航按钮体系，并按 key 持久化布局，节点形态无法参与序列化。
- 找不到视图时**区分两种情况**：插件宿主尚未就绪 → 显示加载态并等待；宿主已就绪但确实无此注册 → 回首页。二者混淆会导致冷启动把停在该路由上的用户直接踢走。

### 2. 侧边栏导航改为布局驱动

- 内置入口与插件工作区视图合成一张**目录（catalog）**，布局只持久化 key 顺序，分为**置顶区（pinned）**与**收纳区（more）**。
- 「新会话」锁定在置顶区首位：不可拖动、不可收纳、不占用户可排布的名额。置顶区含它在内**上限 5 个**。
- 纯逻辑集中在 `sidebar-nav-layout.ts`（对账、pin/unpin、重排、跨区移动、解析），不依赖 React 与存储，可被完整单测覆盖。
- 「更多」弹层同时承担**导航自定义面板**的职责：两区都列出、都可拖拽、都可点 pin 图标切换。不额外做一个设置页——用户想调整入口时，手已经在那个菜单上了。

### 3. 新增 `official.sessions` 渲染端 API

看板这类工作台需要**并发派出多个后台任务**并观察其状态，而既有 `ctx.conversation.*` 只作用于「用户当前正在看的」那个会话。

- 新增 `official.sessions`：`create` / `prompt` / `abort` / `rename` / `list` / `listRunning` / `onRunningChanged` / `open`。
- 实现放在 renderer（与 `official.navigation` 同类），封装已存在的 `window.vetta.session.*`，**不新增主进程 IPC 通道，不扩大宿主能力面**。
- 仅 `trustLevel === "official"` 的插件（即随 App 发布的 preset）可调用，普通插件调用被 `assertOfficialSession` 拒绝。
- 会话本体跑在主进程，因此创建并 prompt 之后，即使宿主停留在别的页面、甚至该插件 UI 未挂载，agent loop 也会继续跑到自然停止点——这正是「后台并发派单」成立的前提。

## 备选方案

| 方案 | 未采纳原因 |
| --- | --- |
| 复用活动 Tab 承载看板 | 活动 Tab 按会话 cwd 持久化显隐，语义上绑定当前对话；跨会话总览放进去是错位的，且面板宽度不适合三泳道 |
| 复用 `registerGlobalSlot` 自绘全屏浮层 | 会覆盖宿主 chrome、拿不到路由与深链、无法参与侧边栏导航，且与「面板类插槽禁止 viewport 级浮层」的既有规范冲突 |
| 看板复用批量任务（batch-tasks）引擎 | batch-tasks 以「项目 + 固定 prompt 模板 + 变量表」为模型，与看板「每张卡是一段自由需求」不匹配；强行套用会同时扭曲两边 |
| 为 `official.sessions` 新开主进程能力通道 | renderer 已持有等价能力，新开通道等于把同一能力实现两遍，且扩大了 preload 暴露面 |
| 侧边栏布局存进主进程 config | 布局是纯前端展示偏好、无跨进程消费方；沿用 `localStorage`（与 `sidebarWidthAtom` 一致）即可，失败时降级为不持久化而非报错 |

## 后果

**正面**

- 插件可以贡献与内置页同级的整页工作台，且入口是用户可编排的。
- 侧边栏导航从硬编码变为数据驱动，新增内置入口不再需要在两个常量数组之间做取舍。
- 布局按 key 持久化：插件卸载不破坏其它项位置，装回来自动复位。

**代价与风险**

- `SidebarNavItem` / `SidebarModel` 是主题 SDK 的公共合同，本次新增了 `workspaceView` / `locked` / `pinned` 字段与四个 action。均为**可选新增**，`SidebarNavigation` 在未收到 `onNavMove` + `navCustomizeLabels` 时退化为改造前的纯列表行为，既有主题（如 xianxia）无需改动。
- `official.sessions` 让 preset 插件能创建真实会话，属于高权能力。缓解：官方来源门控 + preset 权限在 manifest 中显式声明且不可撤销，审阅 preset 时需重点看这一条。
- 置顶区上限 5 是产品取值而非技术约束，写在 `MAX_PINNED_NAV_ITEMS`；超限项**退回收纳区最前**而不是丢弃，保证任何情况下入口都不会静默消失。
