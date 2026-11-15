# ADR-0166：侧边栏常驻，活动面板让出侧栏宽度

## 状态

已接受并实施。

## 背景

活动面板曾被允许把宿主侧边栏「挤走」：面板拖宽或写入 `"max"` 后，只要它超过
`窗口宽度 - 侧边栏宽度 - 聊天区最小宽度`，宿主就自动 `setSidebarCollapsed(true)`；
面板回到阈值内再恢复用户原来的收起状态。这条联动同时存在于两条路径——拖分隔条的
每一帧，以及窗口 resize / 面板开关 / 宽度意图变化的副作用。

实际使用中它带来的是视觉跳动：面板一拉满，左侧一整栏消失，消息区与顶栏一起重排；
把面板拖窄一点又整栏弹回来。侧边栏是主要的项目与会话入口，用户在上述过程中并没有
表达「收起侧栏」的意愿，却要承受整页布局反复位移。自动收起还只发生在本次运行内
（`sidebarCollapsedAtom` 不持久化），重启后恢复展开，进一步放大了不一致感。

## 前置修正：侧边栏不再有「悬浮」形态（本轮）

这条记录的所有宽度计算都假定侧边栏**常驻并贴住窗口左缘**。此前代码里还留着一个可选的
「悬浮」形态（四周留白 + 圆角 + 边框），设置页入口在 ADR-0161 就被删了，但实现一直在：
`sidebar-style.ts`、`sidebarStyleAtom`、`useSidebarStyle`、三组中英文案，以及 `styles.css`
里 11 条 `[data-sidebar-style]` 选择器。旧配置存过 `floating` 的机器上，侧边栏仍会以悬浮形态
出现——与本记录、也与 ADR-0161 的结论互相矛盾。

本轮把这些全部删除：属性与模块不再存在，选择器改成无条件规则，侧边栏只剩一种形态。
宽度计算因此不需要再区分两种边距，`sidebarReserve` 也就是它字面的意思。

## 启动骨架屏也贴边（本轮修订）

删除悬浮侧边栏后，还有一个入口没跟上：`AppBootLoadingView`（theme-ui 的启动骨架屏）里
侧边栏那一列仍是「`rounded-xl` 圆角 + 四周边框 + 外层 `p-2` 留白」的悬浮形态，而真实侧边栏
已经贴边（无圆角、只有右侧分隔线、`-0.5rem` 负 margin 抵消 AppFrame 的 8px 内边距）。于是
启动瞬间先看到一版悬浮侧栏、再跳成贴边侧栏，视觉上就是「旧版悬浮样式的残留」。

修复与 `.sidebar-dock` 的规则同源：侧边栏列去掉圆角与四周边框、改右侧一条 `border-r`，
底色从 `bg-muted/60` 收到与 `.sidebar-surface` 一致的 `bg-muted`，并用 `-ml-2 -mt-2 -mb-2`
抵消外层 `p-2` 的左边/上/下 8px 内边距——与 `styles.css` 里 `.sidebar-dock` 的 `-0.5rem`
负 margin 同一个机制。参照实现至今仍是悬浮骨架屏（`open-vetta` 同文件未改），这是一处
**本仓先行**的收敛，不是照抄上游。

## 决策

1. **侧边栏不再由活动面板宽度自动收起或恢复。** 删除 `useActivityPanelModel` 中
   `reconcileSidebarForWidth` 与那条宽度联动副作用，以及配套的
   `widthCollapsedSidebarRef` / `prevSidebarCollapsedRef`。
2. **面板让出侧栏宽度。** `activityPanelMaxWidth(windowWidth, sidebarReserve)` 与
   `resolveActivityPanelWidth(mode, windowWidth, sidebarReserve)` 新增侧栏占位参数，
   面板上限改为 `窗口宽度 - 侧栏占位 - 聊天区最小宽度 384`。
3. **占位宽度由面板模型写入宽度原子。** `useActivityPanelModel` 读 `useSidebarState().width`，
   侧栏可见性一变就写进 `setActivityPanelSidebarReserveAtom`（窄屏浮层态与用户手动收起时
   该值本身为 0），`activity-atoms` 只用这一个入参算上限。store 层因此不必反向依赖
   `app-shell` 或 `project-atoms`，也不用在模块初始化时去读默认 store；这份占位只是面板
   自己的缓存，不构成第二份持久化事实。
4. **宽度意图保持不变。** `"max"` 仍是持续状态：用户手动收起侧栏时面板随之变宽
   （`窗口宽度 - 384`，仍给聊天区留最小宽），展开后又让回去；固定像素宽度在可用宽度
   变窄时夹紧、变宽时回到原值。写入占位宽度与窗口变化两个入口都在 atom 内部完成一次
   重解析，不需要额外的全局订阅。
5. **窗口放不下时面板改走底部抽屉。** 一列面板至少要同时容下侧栏占位 220、面板最小宽
   260 与聊天区最小宽 384，即窗口宽 ≥ 864（未计 16px 页边与 8px 行内间隙，实际净宽略小）。
   低于这个阈值时 `useActivityPanelModel` 把 `narrowSheet` / `bottomSheet` 置为真，面板从
   底部滑出覆盖内容区，聊天列不再被挤压。阈值随侧栏占位变化：用户手动收起侧栏后回落到
   644，面板恢复占列；侧栏拖宽到 300 则抬到 944。
6. **铺满时不做抽屉。** `activityPanelFocusAtom` 为真时外壳（侧栏 + 全局页头）已经整块让位、
   面板要占满整行；此时若又降级成抽屉，铺满按钮就只在图标上变化、画面毫无反应。所以抽屉
   判定带 `!activityFocus`，且铺满时占位宽度同步归 0（侧栏并不存在，不该扣它的宽）。
7. **手动收起仍然可用。** 页头按钮、侧栏收起按钮与插件 `ui.sidebar.control` 的语义不变，
   只是不再由面板宽度代用户做决定。活动面板「铺满」仍是用户显式动作，保持原有让位行为。

## 备选方案

- **保留联动，但加防抖 / 动画**：只掩盖跳动，侧栏仍会在用户未操作时整栏消失；
  且阈值附近的来回拖动仍会反复触发展开与收起。
- **把面板一直做成覆盖在消息区之上的浮层**：能同时保住侧栏与聊天宽度，但在 900px 以上的
  常见窗口里会永久遮住消息内容，与「面板与消息并排阅读」的既有用法冲突；因此只在「一列
  放不下」时退回这种形态（即底部抽屉），其余宽度仍并排。
- **让面板宽度直接跟随内容行实测宽度**：需要新增 ResizeObserver 与首帧兜底，
  而当前可用宽度的两个输入（窗口宽度、侧栏占位）已经能确定上限，不值得引入新事实源。

## 后果

- 正面：拉满、拖动、resize 过程中左侧布局稳定，不再整栏闪动；面板上限的含义从
  「挤走侧栏后能占多宽」变成「与侧栏并存时还能占多宽」，与实际布局一致。
- 代价：同一窗口下面板能达到的最大宽度变小（减去侧栏占位），宽内容需要更早拖窄；
  用户若想让面板更宽，需要显式收起侧栏，而不是靠面板自动代劳。窗口在 640–864 之间时
  面板不再占列、改从底部滑出，这是为「聊天区不被压成窄条」付的形态代价。
- 兼容性：插件 API 的 `setActivityPanelWidth(width | "max")` 与
  `openActivityTab(id, { width })` 合同不变，仅 `"max"` 的结果随侧栏占位变化；
  `PluginSidebarState` 的 `collapsed` / `narrow` / `visible` / `width` 语义不变。

## 验证

- `apps/desktop/src/renderer/shared/store/activity-panel-width.test.ts`：`"max"` 与固定
  宽度在窗口 resize 时按「窗口 - 侧栏 - 聊天区」解析，意图持久化不变。
- `apps/desktop/src/renderer/domains/activity-panel/hooks/useActivityPanelModel.width.test.ts`：
  真实 React 树里拉满态随窗口 resize 重算；侧栏常驻时 `sidebarCollapsedAtom` 保持 `false`；
  用户手动收起 / 展开侧栏时面板宽度随之变化且宽度意图仍为 `"max"`；窗口窄到放不下
  「侧栏 + 面板 + 聊天区」时面板改走底部抽屉、收起侧栏后恢复占列、侧栏拖宽后阈值上调，
  且铺满时不会被降级成抽屉。
