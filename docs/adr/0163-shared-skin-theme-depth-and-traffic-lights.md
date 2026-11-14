# ADR-0163：共享皮肤、主题层次与 macOS 红绿灯实测对齐

## 状态

已接受并实施。对应 ADR-0157 的 ui、theme、layout、window、activity 五个分组里
「共享控件皮肤 / 弹层外观 / 主题层次 / 红绿灯 / 活动面板边框」这一类条目，共 22 条。

## 背景

这批条目的共同点是**跨界面**：同一处样式决定会同时影响能力页、设置页、对话框、下拉、
确认框、活动面板。参照实现把它们逐个收进 `@vetta-org/ui` 的常量里，再让各处引用——
本仓库此前每个调用点各写一套，改动只影响自己那一处，于是同一类控件在不同页面长得不一样。
红绿灯那条更彻底：位置数字原先写死在主进程，页头高度一变就对不齐。

## 决策

### 1. 共享皮肤常量收进 `packages/ui`

新增四个常量，全部从 `@astravia-org/ui` 导出，调用方不再自己写 `border` / `rounded-*` /
`shadow-*`：

| 常量 | 用途 |
| --- | --- |
| `OVERLAY_BACKDROP_CLASS` | 所有弹出层蒙层：`bg-black/20` + `backdrop-blur-md` + 标记类 `overlay-backdrop` |
| `PANEL_SHADOW_CLASS` | 浮层面板的柔和双层投影，代替边框线 |
| `FLOATING_SURFACE_CLASS` | 下拉 / 弹出面板统一外观：无外边框、`rounded-2xl`、深色补一圈 `ring-white/10` |
| `SELECT_TRIGGER_CLASS` / `SELECT_PANEL_CLASS` | 下拉触发器（muted 底、透明边框占位）与面板（去掉 ring） |
| `INPUT_FILL_CLASS` / `TEXTAREA_FILL_CLASS` | 无边框、secondary 底的填充式输入框 |

理由（参照实现的取舍，本仓沿用）：浅色模式下投影很淡，`bg-popover` 与页面底色只差十几档，
所以浮层在深色下必须补一层极淡描边；而 `INPUT_FILL_CLASS` 用透明边框占位，是为了叠在
`<Input>` 上时不产生 1px 位移。

### 2. 蒙层的 CSS 规则跟随标记类

`.overlay-backdrop` 的 `backdrop-filter` 与磨砂底色写在 `styles.css`，选择器带 `:root`
以压过 Tailwind 的 `backdrop-blur` 工具类。原先给侧边栏写的 `:has(.splash-backdrop)`
规则改为 `:has(.overlay-backdrop)`，覆盖范围从「Splash 面板」扩大到「任何弹出层」——
Dialog 打开时侧边栏同样不能还是清晰的半透明。

### 3. Dialog / 确认框：去线留白

- `DialogContent`：去外边框、`rounded-2xl`、`p-6`、柔和投影；
- `DialogFooter`：通栏底栏（`-mx-6 -mb-6` 抵消内边距）+ 一条淡分隔线 + 略深底色；
- `DialogTitle` 17px semibold，`DialogDescription` 13px；
- 关闭按钮从 `top-2 right-2` 移到 `top-4 right-4`，跟随新的内边距；
- 全局确认框（`ConfirmDialogView`）与 Dialog 同一套：同一蒙层、同一投影、同样通栏底栏，
  按钮从 28px 高改为 36px、13px 字。

未做：`kbv2`「填 Key 输入框改字段名在上的大圆角样式」属设置页表单，随设置批次做。

### 4. 主题：浅色 muted 与 card 拉开层次，mono accent 回到中性

`muted` 在浅色下与 `card` 只差 8 级灰阶，而「无边框控件」正是用 `muted` 做底色，等于看不见。
三个主题按同一配方加深（default 242→238、mono 250→236、sand 234→232），并把 `accent`
再压深一档保证悬停仍可分辨；`mono` 的浅色 `card` 248→245（原先与背景几乎同白）。
`mono` 的 accent 经过四轮调整（偏蓝 → 更淡蓝灰 → 灰 → 中性灰），最终取纯中性灰
`rgb(46,46,46)` / `rgb(224,224,224)`：mono 主题的定位是无色相，带蓝会与其它主题混淆。

### 5. macOS 红绿灯：由渲染进程实测页头上报

位置数字不再写死。链路：

1. `SidebarTopBar` 的 actions 行与 `PageHeaderFrame` 的内容行标 `data-titlebar-anchor`；
2. renderer 的 `useTitlebarAnchor(layoutKey)` 用 `ResizeObserver` + `resize` 实测该行中线
   （跳过带 `inert` 的子树，否则侧栏收起后会量到看不见的那条），变化才上报；
3. 主进程 `setTitlebarCenter` 存下中线，`trafficLightPositionFor(center, factor)` 换算成
   屏幕 px（红绿灯不随网页缩放，所以乘缩放比、减去框顶到圆心的 9pt）；
4. 全屏进出、还原、重新显示后系统可能把按钮放回默认位置，这几处再套一次；
5. 首帧没有上报值时用 `TITLEBAR_CENTER_FALLBACK = 28`。

同时给红绿灯的横向让位改成 `calc(78px / var(--ui-zoom, 1))`：让位是屏幕像素，页面缩放后
78 个 CSS px 就不够宽了。页头内容整体 `top-[-2px]` 与红绿灯视觉中线对齐。

### 6. 活动面板只留左上圆角与左、上边框

面板右、下两边贴内容区，画圆角和线只会让它在贴边处留下一条浮起的缝。标签行顶部
`pt-1 → pt-3`，与顶栏按钮之间多留一点空隙。

### 7. 拖动面板宽度后标签轮廓不再消失

`ActiveTabIndicator` 原先在「暂停布局动画」时换成另一种元素（`span` 替代 `motion.span`），
节点重建会让宽度状态回到 0，而尺寸不再变化时 `ResizeObserver` 不一定再回调，
三边轮廓就再也画不出来。改为始终同一个 `motion.span`，只把 `layoutId` 置空、过渡时长置 0，
并在 `useLayoutEffect` 里先量一次 `offsetWidth`。

## 备选方案

- **继续每个调用点各写一套样式**：这批条目本身就是「同一控件在不同页面不一致」的产物，
  再逐点修只会把分叉往后推。
- **只改浅色主题的 muted**：深色与 mono/sand 会有同样的层次问题，配方一致才能避免下次
  又只修一个主题。
- **红绿灯继续用写死数字**：页头高度、沉浸式页头、界面缩放三者任一变化都会错位，
  而这三种变化都在这一批里出现过（`t2cf` / `j9nc` / `2cs8` / `dl22` 就是同一处反复微调）。
- **用 CSS 变量把红绿灯位置写死在渲染层**：原生按钮不在网页坐标系里，只能由主进程设置。

## 后果

- 正面：对话框、确认框、下拉、输入框在四个界面里终于同一套外观；浅色主题下无边框控件可辨；
  红绿灯不再依赖写死的数字，页头怎么改都对得齐；活动面板贴边处不再有缝；拖动面板后
  标签边框留得住。
- 代价：`packages/ui` 的导出面又大了一截；`--ui-zoom` 成为 theme-ui 里一个隐含依赖
  （缺省按 1 处理）；主进程多一条 `ipcMain.on` 通道与三个窗口事件监听。
- 已知限制：`--ui-zoom` 与红绿灯实测只在 macOS 生效，其它平台走原路径；
  红绿灯的「对齐」需要实机窗口才能确认，本批只有换算函数的用例，没有真机断言。

## 验证

- `apps/desktop/src/shared/ui-zoom.test.ts`：中线到框顶的换算（100% / 125% / 缺省）、
  上报值的有限与范围校验。
- `bun run check:quick`：本批 22 个文件 lint + 架构守卫通过。
- `bun run test:impact`：`ui` 包既有用例（`button-group`、`session-top-item`、`floating-surface`、
  `step-slider`、`drawer`）与 `ui-zoom` 用例全绿。
- 待实机核对：Dialog/确认框/下拉的新外观、浅色主题层次、活动面板贴边效果、红绿灯位置。
