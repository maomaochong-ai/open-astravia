# ADR-0180：活动面板全屏在常驻侧边栏下的布局与红绿灯定位修复

## 状态

已接受，已实施（红绿灯定位部分；文件树裁剪待实机验证）。

## 背景

ADR-0166 把侧边栏改为常驻（不再随活动面板变宽自动收起），但活动面板的「全屏」（铺满）
按钮走的是另一条路径：`activityPanelFocusAtom` 为 true 时，根布局让侧边栏与全局顶栏整体
让位、`AppFrame` 取消 8px 外边（`contentClassName="p-0"`），面板铺满整行。这条路径在
侧边栏常驻后暴露出三个问题：

1. **文件树全屏被裁剪**：铺满态下面板宽度按内容行实测，但 `p-0` 切换与测量有时序差，
   面板可能停留在旧尺寸；
2. **倾斜**：`useActivityTabMaximize` 靠「先把行内 flex 间隙收掉再量」来贴住两侧，这个
   不动点在侧边栏常驻后可能与实际渲染的间隙不一致，导致面板左边缘浮起一条缝；
3. **macOS 红绿灯距离顶部不合适**：铺满时侧边栏与页头两个 `data-titlebar-anchor` 都消失，
   红绿灯中线量不到，停留在旧位置。

## 决策

### 1. 红绿灯：铺满态回到默认中线，且把铺满纳入重测触发

`useTitlebarAnchor(layoutKey)` 的 `layoutKey` 之前是
`${pageLayout}:${narrow}:${sidebarCollapsed}:${immersive}`，**漏了 `activityFocus`**。
铺满/退出铺满都不会触发重测；而铺满时两个锚点（`SidebarTopBar`、`PageHeaderFrame`）都
卸载，`measureTitlebarCenter` 返回 `undefined`，主进程 `setTitlebarCenter` 忽略空值，
红绿灯就停在「还有页头」时测的中线上。

修复：

- `layoutKey` 纳入 `activityFocus`，铺满切换必然重测；
- 铺满态给一个明确的兜底中线：`useTitlebarAnchor` 增加可选 `fallbackCenter` 参数，
  锚点量不到时用它上报。铺满态传 `TITLEBAR_CENTER_FALLBACK`（28），红绿灯回到
  macOS 默认 titlebar 中线；退出铺满后锚点恢复、重新测真实中线。

这条把「红绿灯的唯一来源是渲染进程实测中线」的既有约定保持住——铺满态只是「没有页头
可量」时的一个确定性兜底，不是第二套硬编码位置。

### 2. 文件树裁剪与倾斜：先修测量时序，再实机验证

`useActivityTabMaximize` 的测量不动点（收掉 flex 间隙 → 量整行宽 → 写入）逻辑本身是对的，
问题在「测量时机」与「`p-0` 生效时机」不保证先后。本轮先做两件事：

- 把宽度测量从「一次量 + ResizeObserver 后续量」改为「在 `p-0` 生效后的下一帧再量一次」，
  消除首帧的旧宽度残留；
- 记录 `data-activity-focus` 到 `:root`，让面板自身能据铺满态做 CSS 修正（如去除
  左边缘缝），而不是只靠 JS 量宽。

这两条是防御性的、不改变正常态行为。真正的「裁剪/倾斜」形态需要在有文件树的项目里
实机点击全屏按钮确认——Fresh 空状态没有文件树，无法复现，因此这部分列为**待实机验证**，
不以猜测的形态为修复依据。

### 3. 僵尸代码清理（同批，但不是本 ADR 的主体）

探查开发壳时发现 3 处历史迭代遗留的重复块（其他会话实施探针时留下的），导致开发壳无法
启动，已一并清理并在此登记：

| 文件 | 残留 | 清理 |
| --- | --- | --- |
| `preload/apis/system.ts` | `diagnostics` 块重复两行 | 删除重复的 `exportDiagnosticsPackage` / `getLogDir` |
| `main/ipc/session.ts` | `GET_FULL_HISTORY`、`VIEWER_OPEN_TAIL` 处理器各重复一段 | 保留带 `loopLagProbe.tag` 的版本，删除无 tag 的重复块 |
| `renderer/main.tsx` | `error-monitoring` / `vite-hmr-diagnostics` 的 import 与初始化各重复一次 | 删除重复 import 与 `initializeRendererErrorMonitoring` 调用 |

## 备选方案

- **红绿灯在铺满时固定硬编码一个 y**：简单，但违背「红绿灯位置只有一个来源（实测中线）」
  的既有约定，退出铺满后要再切回实测值，多一条并行状态。
- **铺满态保留一个隐形锚点**：让 `measureTitlebarCenter` 始终有值可量。但铺满态本来
  就没有页头，塞一个 0 高的锚点只是绕开「无锚点」这个事实，不如显式给兜底中线。

## 后果

- 正面：铺满/退出铺满时红绿灯回到正确位置，不再停在旧中线；测量时序更稳。
- 代价：`useTitlebarAnchor` 多一个可选参数；铺满态的中线是兜底值而非实测（但铺满态
  本来就没有可实测的页头）。
- 已知限制：文件树裁剪/倾斜需在有文件树的项目里实机验证，本轮只做防御性修正，
  不按猜测改布局。

## 验证

- `useTitlebarAnchor` 用例：layoutKey 变化触发重测、fallbackCenter 在无锚点时生效；
- `FullScreenToggleButton` / `useActivityTabMaximize` 用例：铺满/退出铺满的原子状态、宽度
  测量与还原（已有，扩展铺满态断言）；
- 实机：在真实项目里点击文件树的全屏按钮，确认红绿灯位置、面板贴边与不被裁剪
  （仅用户要求时跑 `verify:ui:*`）。
