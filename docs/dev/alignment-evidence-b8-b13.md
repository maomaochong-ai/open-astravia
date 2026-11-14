# B8–B13 上游对齐证据报告

> 目标：把 ADR-0157 登记表中 B8–B13 的每一条，映射到上游 `open-vetta` 仓库 `v0.5.73..v0.5.81`
> 的具体提交，并核实本仓 `open-astravia` 的真实落地状态。
>
> 本报告只读代码，不修改任何源码。

## 0. 方法与快照

| 项 | 值 |
| --- | --- |
| 上游仓库 | `/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta`，标签 `v0.5.72` … `v0.5.81` |
| 上游基线 | `v0.5.81` = `488724ad8`（`chore(release): 合并 dev 发布 v0.5.81`） |
| 本仓 | `/Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia` |
| 本仓 HEAD | `367cb3ea0`（B3 三栏模型选择器） |
| 证据采集时间 | 2026-11-14 21:20–21:45 |
| 判定口径 | 只按源码、类型定义、i18n 资源、测试与文档实际内容判定；不按提交标题或 ADR 状态列判定 |

**重要前提（并发改动）**：本仓工作区当时有 298 项未提交改动（B6–B8 及部分批次的落地），
且证据采集期间 `packages/plugins/presets/open-in-app/` 被并行创建（目录 mtime 21:30–21:32），
`packages/theme-ui/src/plugin-ui/index.ts` 保持未改动。因此：

- 本报告的状态是**时间点快照**，B11 在采集末尾由「未实现」翻为「已实现（未跟踪）」；
- 所有「已实现」判定都以文件内容为证据，不依赖 `git status`；
- 若后续有并行改动，请以同一路径重新核对，本报告的 file:line 可直接复查。

判定词汇沿用 ADR-0157：`已实现` / `部分实现` / `未实现`；另外标出 `等价实现（路径不同）`
与 `被上游后续提交取代`。

## 1. 结论总表

| 批次 | 条目 | 上游提交 | 本仓判定 |
| --- | --- | --- | --- |
| B8 | 3cnb 顶栏探针去重 / useActiveConversation / 关模糊 | `2e2d5df56` | **部分实现**（探针去重 + 关模糊已完成；`useActiveConversation` 仍订阅整个会话） |
| B8 | 2h7p 顶栏默认终端/底部面板/导出 + 收纳选中态 + 置顶露出 | `2f4ac4f63` | **已实现** |
| B8 | s3ot 顶栏默认改为外部应用/Finder… | `72d809747` | **被 2h7p 取代**，最终态已实现 |
| B8 | uqi7 收纳与调整按钮垫不透明底 | `d94ef1a76` | **已实现** |
| B8 | fair 调整模式打勾按钮用主色底 | `3c37f238b` | **已实现** |
| B8 | 6vtq 收纳改为按钮组下方第二胶囊 | `8efa385a8` | **已实现** |
| B8 | lkyf 收纳图标一致 / 活动面板独立成组 / 拖动指示 | `234885a88` | **已实现** |
| B8 | vld7 沉浸式下活动面板让出顶栏高度 | `31efc483a` | **已实现** |
| B8 | 7n99 侧栏收起时按钮组与标题间距 | `c21409f33` | **已实现** |
| B8 | 44o7 沉浸式顶栏 | `22c5738bd` | **已实现**（ADR-0157 / 0165 记「未做」已过时） |
| B8 | hhe6 滚到顶首条消息不被顶栏挡住 | `cca81dd2d` | **已实现**（ADR-0157 记「不适用」已过时） |
| B9 | ezqp registerHeaderAction 声明式 | `09960c3d6` `d242d54e5` `1806448a0` `7e0a8b130` `5a9d03fa1` | **已实现** |
| B9 | egco 插件可用按钮组 / 设置页下拉 / 设置项卡片 + 文档 | `a50993e86` | **部分实现**（`ButtonGroup`/`Button field` 可用；`plugin-ui` 未开放 `MotionSelect`/`SettingSection`/`SettingRow`/`SettingHeading`；插件文档无组件速查） |
| B9 | fvqa `ctx.command.appIcon` | `2505cbe6f` | **已实现** |
| B9 | fej0 appIcon 改读 `.icns` | `84fdd1472` | **已实现** |
| B10 | pan7 宿主渲染 ModelPicker | `738949766` `e4042b282` | **未实现** |
| B10 | r81i ModelPicker `menuClassName` | `5a0fce85a` | **未实现**（依赖 pan7） |
| B10 | 129g 宿主各处模型选择器与输入栏同源 | `332ea2735` | **部分实现** |
| B10 | v01k content-creation 改用宿主 ModelPicker | `cc2d14711` | **未实现** |
| B10 | qzkn chinese-chess 改用宿主 ModelPicker | `05df907dd` | **未实现** |
| B10 | jhbp kanban 改用宿主 ModelPicker | `efa5addf4` | **等价实现（路径不同）**：直接用 `plugin-ui` 的 `ModelSelectorView`，未走 SDK 合同 |
| B11 | 8h4q 新增系统插件「从外部应用打开」 | `cca2f7ff3` | **已实现（未跟踪）** |
| B11 | r6ne 菜单列出全部应用、没装置灰、图标用应用自己的 | `40b803e70` | **已实现** |
| B11 | cttc 激活清理只释放自己的接口 | `9a56bd05a` | **已实现** |
| B12 | llr7 桌面端与 Agent 能力接入 sse | `7c58c7313` | **已实现** |
| B12 | 9d56 运行时支持旧式 HTTP+SSE | `db2024a88` | **已实现** |
| B12 | dqpd `mcp.manage` 指定全局/项目层 | `46f2f3dbb` | **未实现** |
| B12 | ro8e 项目层并入根目录 `.mcp.json` | `1b2487f3a` | **已实现**（文档站未同步） |
| B13 | 6d2h install-ability 不读配置文件、不主动探测 | `4a5fec47e` | **未实现** |
| B13 | 4b7x install-ability 安装 MCP 前先问层级 | `d2c6a28e4` | **未实现**（阻塞于 dqpd） |

按批次统计（30 条）：

- 已实现 / 等价实现：19 条
- 部分实现：3 条（3cnb、egco、129g）
- 未实现：7 条（pan7、r81i、v01k、qzkn、dqpd、6d2h、4b7x；其中 r81i 依赖 pan7、4b7x 与 6d2h 依赖 dqpd）
- 被上游取代：1 条（s3ot）

---

## 2. B8：会话页顶栏收尾与沉浸式

### 2.1 3cnb —— 顶栏动作探针去重、`useActiveConversation` 只订阅所需字段、按钮组关背景模糊

**上游提交**

- `2e2d5df56` `perf(chat): 顶栏动作探针去重发布、useActiveConversation 只订阅所需字段，按钮组关掉背景模糊`

**上游改动实质**

- `apps/desktop/src/renderer/domains/header-actions/normalize.ts`（新增 `headerActionSignature`）
  与 `ConversationHeaderActions.tsx`：探针在 `useLayoutEffect` 里按签名比对，签名不变就不重新发布；
  插件的 `onClick` / `onSelect` 通过 `latest` ref 读最新声明，避免捕获旧闭包。
- `apps/desktop/src/renderer/domains/plugins/runtime/plugin-host-bridge.ts`：`useActiveConversation()`
  从 `activeSessionAtom` 改为 `activeSessionRuntimeIdAtom` / `activeSessionCwdAtom` /
  `activeSessionPathAtom` 三个派生 atom，避免流式期间每条消息都让常驻探针重渲。
- `apps/desktop/src/renderer/shared/store/chat-atoms.ts`：新增 `activeSessionRuntimeIdAtom`、
  `activeSessionPathAtom`。
- `packages/theme-ui/src/chat/HeaderActionBarView.tsx`：两处 `<ButtonGroup>` 加 `blur={false}`。
- 无新公共合同（`chat-atoms` 是 renderer 内部状态）。

**本仓现状：部分实现**

| 上游改动 | 本仓 | 证据 |
| --- | --- | --- |
| 探针按签名去重 | 已做 | `apps/desktop/src/renderer/domains/header-actions/ConversationHeaderActions.tsx:120-127`（`headerActionSignature` + `published` 比对 + `useLayoutEffect`）；`header-actions/normalize.ts` 已存在 |
| 回调走 `latest` ref | 已做 | 同文件 `:27-84`（`toBarItem(..., latest)`）、`:118-119` |
| `useActiveConversation` 只订阅派生字段 | **未做** | `apps/desktop/src/renderer/domains/plugins/runtime/plugin-host-bridge.ts:792-805` 仍是 `useAtomValue(activeSessionAtom)` + `useMemo([active,...])` |
| 派生 atom | **只做了 cwd** | `apps/desktop/src/renderer/shared/store/chat-atoms.ts:269` 只有 `activeSessionCwdAtom`，无 `activeSessionRuntimeIdAtom` / `activeSessionPathAtom` |
| `ButtonGroup blur={false}` | 已做 | `packages/theme-ui/src/chat/HeaderActionBarView.tsx:534, 552, 631, 721` |

**结构差异**：本仓 `ChatView` 不在 `apps` 侧拼装按钮，而是把 `builtins` 交给
`ConversationHeaderActions`（`apps/desktop/src/renderer/domains/conversation/components/ChatView.tsx:124`），
探针宿主在其内部（`ConversationHeaderActions.tsx:141-172`）。这一点比上游更收敛，
补 `useActiveConversation` 时不需要动按钮装配。

**落地难点**：低。仅需在 `chat-atoms.ts` 加两个 `selectAtom` 并改 `plugin-host-bridge.ts`
一个函数；注意 `cwd` atom 已有消费方（`ChatView`、插件），新增 atom 不要重复派生。

### 2.2 2h7p —— 顶栏默认改终端/底部面板/导出，收纳显示选中态，置顶开启时从收纳露出

**上游提交**：`2f4ac4f63`

**上游改动实质**

- `apps/desktop/src/renderer/domains/header-actions/layout.ts`：
  `DEFAULT_TOP_ACTIONS` 从 `["open-in-app:open-in-app", "builtin:bottom-panel", "builtin:export"]`
  改为 `["builtin:terminal", "builtin:bottom-panel", "builtin:export"]`。
- `packages/theme-ui/src/chat/HeaderActionBarView.tsx`：`HeaderActionBarItem` 新增
  `promoteWhenActive`；`promoted = editing ? [] : tray.filter(promoteWhenActive && active)`，
  与 `pinned` 同组渲染；`TileFace` / `TileFaceTrigger` 补 `data-active` + `aria-pressed`。
- `ChatView.tsx`：`builtin:pin` 加 `promoteWhenActive: true`。

**本仓现状：已实现**

| 上游改动 | 本仓 | 证据 |
| --- | --- | --- |
| 默认顶栏三项 | 已做 | `apps/desktop/src/renderer/domains/header-actions/layout.ts:18`（`["builtin:terminal","builtin:bottom-panel","builtin:export"]`） |
| `promoteWhenActive` 字段 | 已做 | `packages/theme-ui/src/chat/HeaderActionBarView.tsx:62-66` |
| 选中态从收纳露出 | 已做 | 同文件 `:472-473`（`promoted` → `beside`）、`:720-727`（`beside` 与 `pinned` 同组） |
| 收纳图标选中态可见 | 已做 | 同文件 `:238-241`（`data-active` / `aria-pressed` / `data-[active]:bg-foreground/[0.22]`） |
| 置顶加 `promoteWhenActive` | 已做 | `apps/desktop/src/renderer/domains/conversation/components/ChatView.tsx:85-93` |

**落地难点**：无。注意本仓已在同一处加了 `retainWhenNarrow`（`:71`），
这是上游 `25c43ece2`（b0tk）的窄窗需求，两者共存。

### 2.3 s3ot —— 顶栏默认只显示从外部应用打开、底部面板、导出

**上游提交**：`72d809747`

**上游改动实质**：`DEFAULT_TOP_ACTIONS` 引入（首版含 `open-in-app:open-in-app`），
`resolveHeaderLayout` 新增 `defaultTop` 参数分支，`layout.test.ts` 同步。

**本仓现状：被上游后续提交取代，最终态已实现**

上游 2 小时后在同一天用 `2f4ac4f63` 把默认值改成「终端 / 底部面板 / 导出」，并把
`open-in-app` 移到收纳。本仓取的是最终态（`layout.ts:18`），`defaultTop` 分支也在
（`layout.ts:45-51`）。**不需要按 s3ot 的中间态再改一遍**。

**落地难点**：无。建议在 ADR-0157 中把 s3ot 标注为「已被 2h7p 取代」，
否则会与 2h7p 的验收标准自相矛盾。

### 2.4 uqi7 —— 收纳与调整按钮垫不透明底

**上游提交**：`d94ef1a76`（单文件 13 行）

**上游改动实质**：`HeaderActionBarView.tsx` 抽出 `OPAQUE_GLASS`：不透明 `bg-background`
叠加 `foreground 6%` 渐变（深色为 `white 8%`），用于收纳胶囊与「调整」按钮，
避免透过它们看到下面的活动面板 / 消息流。

**本仓现状：已实现**

- `packages/theme-ui/src/chat/HeaderActionBarView.tsx:108-113`（`OPAQUE_GLASS` 常量与注释）
- `:634`（调整按钮）、`:665`（收纳胶囊）两处引用。

**落地难点**：无。

### 2.5 fair —— 调整模式下打勾按钮用主色背景

**上游提交**：`3c37f238b`

**上游改动实质**：`HeaderActionBarView.tsx` 调整按钮在 `editing` 时加
`bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground`。

**本仓现状：已实现**

- `packages/theme-ui/src/chat/HeaderActionBarView.tsx:641-657`：`data-header-action-adjust`、
  `aria-pressed={editing}`、`className={editing ? "bg-primary text-primary-foreground …" : undefined}`、
  图标在 `check-read` / `tuning-2` 间切换。

**落地难点**：无。

### 2.6 6vtq —— 收纳改为按钮组下方的第二个胶囊，展开带动画并收起小白条

**上游提交**：`8efa385a8`

**上游改动实质**

- 去掉 `Popover` 外壳，收纳改为 `absolute top-full right-0 mt-1.5 rounded-[18px] p-1` 的第二颗胶囊，
  `animate-in fade-in-0 zoom-in-95 slide-in-from-top-1`。
- 小白条（`data-header-action-tray-handle`）在 `open` 时不再渲染 / 不可点。
- 新增 `rootRef` + `pointerdown`（capture）+ `Escape` 收起；Radix 浮层内点击不算「点外面」。
- 收纳图标加底色 `bg-foreground/[0.08]`，4 列网格。

**本仓现状：已实现**

- 小白条与展开态互斥：`HeaderActionBarView.tsx:600`（`narrow === null && !emptyBar && !open`）
- 收起逻辑：`:443-460`（`pointerdown` capture + `Escape`，排除 `[data-radix-popper-content-wrapper], [role='menu']`）
- 第二胶囊：`:660-668`（`data-header-action-tray`、`OPAQUE_GLASS`、`animate-in … slide-in-from-top-1`）
- 4 列网格：`:669-675`（`gridTemplateColumns: repeat(min(4, max(1, tray.length + editing)), 2rem)`）
- 收纳图标底色：`:241`、`:384`

**落地难点**：无。

### 2.7 lkyf —— 收纳图标与按钮组一致、活动面板开关独立成组、修正拖动指示

**上游提交**：`234885a88`（`HeaderActionBarView.tsx` 94 行 + 顶栏热更新用例）

**上游改动实质**

- 收纳 `Tile` 与顶栏 `BarItem` 共用同一套图标盒子与尺寸（`h-7 w-8`）。
- 活动面板开关（`pinned`）从「与收纳按钮同组」改为独立 `ButtonGroup`，固定最右、不参与排序收纳。
- 拖动指示改为伪元素竖线（`after:` 系列），不再用内阴影。

**本仓现状：已实现**

- 活动面板独立成组：`HeaderActionBarView.tsx:718-727`（注释「活动面板开关是个独立的小组」+ 独立
  `<ButtonGroup blur={false}>`）
- 图标盒子统一：`IconBox`（`:119-140`），`BarItem` 与 `TileFace` 共用
- 拖动指示：`:516-517`（`lineBefore` / `lineAfter` 伪元素）+ `:592-593`

**落地难点**：无。

### 2.8 vld7 —— 沉浸式顶栏下活动面板让出顶栏高度

**上游提交**：`31efc483a`

**上游改动实质**：`DefaultChatView.tsx` 的横向行加
`[[data-header-overlay=true]_&]:pt-11`，消息列加 `[[data-header-overlay=true]_&]:-mt-11`
（整行让出 44px 顶栏，消息列再抵回去保持渐隐铺到顶栏下）。

**本仓现状：已实现**

- `apps/desktop/src/renderer/domains/conversation/components/chat-view/DefaultChatView.tsx:97-106`
  （两处类名与上游逐字一致，注释也对齐）。

**落地难点**：无。

### 2.9 7n99 —— 侧边栏收起时按钮组与会话标题之间留出间距

**上游提交**：`c21409f33`

**上游改动实质**：`packages/theme-ui/src/app-shell/PageHeaderContent.tsx` 的
`expand-group` 容器 `shrink-0` → `mr-2 shrink-0`（左簇被宿主压成 `gap-1`，再让 8px）。

**本仓现状：已实现**

- `packages/theme-ui/src/app-shell/PageHeaderContent.tsx:49`（`className="mr-2 shrink-0"`，
  注释「左簇被宿主压成 gap-1…」）。

**落地难点**：无。

### 2.10 44o7 —— 会话页顶栏改为沉浸式，消息流在顶栏下平滑渐隐

**上游提交**：`22c5738bd`

**上游改动实质（新的宿主合同）**

- `packages/theme-ui/src/layout/MainContentFrame` 的 `headerOverlay` 由
  「插件工作区视图声明」扩展为「插件视图 **或** 页面自己声明」。
- 新增 renderer atom `pageHeaderImmersiveAtom`（`apps/desktop/src/renderer/shared/store/ui-atoms.ts`）。
- `ChatView` 挂载期间置 `true`、卸载复位；`RootLayoutView` 读它并传给 `MainContentFrame`。
- `MessageFeedLayoutView.tsx` 在 `[[data-header-overlay=true]_&]` 下换 mask：
  0–28px 全透明，28–100px 沿多段色标渐显（近似 ease-in-out），底部仍保留 32px 渐隐；
  同时 `pt-24`。

**本仓现状：已实现**

| 上游改动 | 本仓 | 证据 |
| --- | --- | --- |
| `headerOverlay` 支持页面声明 | 已做 | `packages/theme-ui/src/layout/MainContentFrame.tsx:16, 24, 38, 45`；`apps/desktop/src/renderer/root-layout/RootLayoutView.tsx:65, 150` |
| `pageHeaderImmersiveAtom` | 已做 | `apps/desktop/src/renderer/shared/store/ui-atoms.ts:63` |
| `ChatView` 置位/复位 | 已做 | `apps/desktop/src/renderer/domains/conversation/components/ChatView.tsx:62, 154-158` |
| 沉浸式 mask | 已做 | `packages/theme-ui/src/chat/MessageFeedLayoutView.tsx:29-38`（28px 全透明 + 7 段色标 + 底部 32px） |

**注意（文档漂移）**：ADR-0157 第 12 行与 ADR-0165「后果 / 已知限制」都写着
「页头浮层化未做」、状态记 `部分对齐` / `不适用`。源码显示它已经做完，
ADR-0165 的「保留 / 放弃」段落也把它当作未实施方案在论证。**这是文档落后于实现**，
不是实现缺失。

**结构差异**：上游把「页面沉浸式」与「插件工作区视图沉浸式」放在同一个 `headerOverlay` 布尔上；
本仓同样合并（`RootLayoutView.tsx:150` 用 `||`），语义一致。

**落地难点**：无（已落地）。需要补的是 ADR-0165 / 0157 的状态回写。

### 2.11 hhe6 —— 滚到顶时第一条消息不再被沉浸式顶栏挡住

**上游提交**：`cca81dd2d`

**上游改动实质**

- 结论：顶部留白不能放在滚动容器的 `padding` 上（Virtuoso 视口是
  `position:absolute; top:0; height:100%`，会盖住 padding）。
- 改为列表流里的 `MessageFeedLayoutTopInset`：`h-0`，沉浸式下 `h-[80px]`，
  由 `VIRTUAL_COMPONENTS.Header` 挂载。
- mask 保留（顶部 28px 全透明 + 渐显）。

**本仓现状：已实现**

- `packages/theme-ui/src/chat/MessageFeedLayoutView.tsx:102-115`（`MessageFeedLayoutTopInset`，
  `data-message-feed-layout-part="top-inset"`、`h-[80px]`）
- `packages/theme-ui/src/chat/MessageFeedView.tsx:138-143`（`VIRTUAL_COMPONENTS.Header`）
- `MessageFeedLayoutView.tsx:122`（`MessageFeedLayout.TopInset` 导出）

**判定修正**：ADR-0157 该条状态是「不适用（本仓页头不是浮层，消息流不在顶栏之下）」。
既然 44o7 已落地，这条**适用且已实现**，不能记为不适用。

**落地难点**：无。

---

## 3. B9：插件顶栏动作与插件 UI 合同

### 3.1 ezqp —— 新增会话页顶栏动作贡献点 `registerHeaderAction`

**上游提交（一条行为的四次迭代，最终态以 `1806448a0` 的文档为准）**

- `09960c3d6` `feat(plugin): 新增会话页顶栏动作贡献点 registerHeaderAction`
- `7e0a8b130` `feat(chat): 会话页顶栏按钮组统一管理，插件顶栏动作改为声明式…`（与 s3ot/2h7p 同批）
- `1806448a0` `docs(plugin): 顶栏动作文档改为声明式合同，写明工程限制与收纳规则`
- `d242d54e5` `chore(plugin-sdk): 顶栏动作合同定版 0.3.13，补清单权限合同测试`
- `5a9d03fa1` `test(plugin): 补顶栏动作热更新用例，换 hook 与移除都应原地生效`

**上游改动实质（新增公共合同）**

| 层 | 内容 |
| --- | --- |
| SDK 类型 | `PluginHeaderActionContribution { id, order?, useAction }`；`useAction()` 返回 `{ title, icon, badge?, active?, disabled?, onClick \| menuItems \| popover }` 或 `null` |
| 权限 | `ui.slot.header-action`（缺失 = warn + noop） |
| Plugin API | `^2.9.0`（`plugin-api-version.ts` 增一条） |
| 宿主 | `pluginHeaderActionsAtom` + 探针宿主 + `normalize.ts` 校验（title ≤ 40、menuItems ≤ 20、非法项丢弃） |
| 文档 | `docs/plugin/ui-slots.md` 新增「会话页顶栏动作」整节，明确「不能传 className / style，外观由宿主渲染」 |

**本仓现状：已实现**

| 上游 | 本仓证据 |
| --- | --- |
| 类型与 API 方法 | `packages/plugins/plugin-sdk/src/ui.ts:681`（注释）、`:760-763`（`registerHeaderAction(contribution)`） |
| 权限 | `packages/plugins/plugin-sdk/src/permissions.ts:14`（`"ui.slot.header-action"`） |
| Plugin API 版本 | `apps/desktop/src/main/plugins/plugin-api-version.ts:9`（2.9.0 条目）、`:14`（`PLUGIN_API_VERSION = "2.9.0"`） |
| 宿主注册 + 校验 | `apps/desktop/src/renderer/domains/plugins/runtime/plugin-ui-context.ts:478-503`（权限门控、id ≤ 64、重复注册抛错、`useAction` 必须是函数）、`:1042` |
| 状态源 | `apps/desktop/src/renderer/shared/store/plugin-atoms.ts:245`（`pluginHeaderActionsAtom`） |
| 声明式渲染 | `apps/desktop/src/renderer/domains/header-actions/ConversationHeaderActions.tsx`（探针 + `HeaderActionBarItem` 三态：click/menu/popover） |
| 文档 | `docs/plugin/ui-slots.md:692-790`（注册、三选一行为、7 格上限、收纳与布局记忆） |
| 测试 | `apps/desktop/src/renderer/domains/plugins/runtime/plugin-header-action.test.tsx`（含热更新、promote、窄窗） |

**结构差异**：本仓的 `HeaderActionBarItem.key` 由宿主拼成 `<pluginId>:<actionId>`，布局存储按该 key；
上游同此。文档一致。

**落地难点**：无（已落地）。**但注意 SDK 版本没跟上**：本仓 `plugin-sdk/package.json` 仍是
`0.3.11`，新增合同写在 `CHANGELOG.md` 的 `[Unreleased]` 节；上游在 `d242d54e5` 已定版 `0.3.13`。
后续 B10 要在同一个包里加 `ModelPicker`（上游 0.3.12），必须一起把版本推进规划好，
否则「要求 `^2.9.0`」的插件在 npm 上拿不到对应的 SDK 版本。

### 3.2 egco —— 插件可用按钮组、设置页同款下拉与设置项卡片，补插件文档

**上游提交**：`a50993e86`

**上游改动实质**

- `packages/theme-ui/src/plugin-ui/index.ts` 新增导出：`MotionSelect`、
  `SettingSection` / `SettingRow` / `SettingHeading`（含类型）。
- `packages/plugins/plugin-sdk/CHANGELOG.md` 说明 `@vetta-org/ui` 的 `ButtonGroup` /
  `ButtonGroupItem` 与 `Button` 的 `field` 变体随宿主发布（Desktop 0.5.79+）。
- `docs/plugin/styling-and-pitfalls.md` 新增两块：**「可用组件速查」**（`Button` variants/sizes、
  `ButtonGroup*`、`DropdownMenu*`、`Select*`、`POPover`/`Dialog` 等）与
  **「设置页同款组件」**（`MotionSelect`、`SettingSection`、`SettingRow`、`SettingHeading` 的 props 与示例）。
- 无 SDK 接口变化（纯 UI 合同 + 文档）。

**本仓现状：部分实现**

| 上游改动 | 本仓 | 证据 |
| --- | --- | --- |
| `@astravia-org/ui` 的 `ButtonGroup`/`ButtonGroupItem` 对插件可用 | 已做 | `packages/ui/src/index.ts:2-10`；`packages/plugins/plugin-vite/src/index.ts:78, 119, 135`（`@astravia-org/ui` 作为 MF 共享域） |
| `Button` 的 `field` 变体 | 已做 | `packages/ui/src/button.tsx:16` |
| `plugin-ui` 开放 `MotionSelect` | **未做** | `packages/theme-ui/src/plugin-ui/index.ts`（26 行）只有 `ModelSelectorView`、`MultiplierTag`、`provider-icon`；`MotionSelect` 仅存在于 `packages/theme-ui/src/settings/MotionSelect.tsx:34` |
| `plugin-ui` 开放 `SettingSection`/`SettingRow`/`SettingHeading` | **未做** | 同上；实现只在 `packages/theme-ui/src/settings/SettingChrome.tsx:11, 39` |
| 插件文档组件速查 | **未做** | `docs/plugin/styling-and-pitfalls.md` 无 `MotionSelect` / `SettingSection` / `ButtonGroup` 任何字样（`grep` 零命中） |

**结构差异**：本仓把设置页皮肤放在 `theme-ui/settings`，插件入口是 `theme-ui/plugin-ui`
（有意收窄的清单，见该文件头注释）。上游的开放方式可以直接照搬：加 4 个导出 + 两节文档，
不需要改组件本身。

**落地难点**：低-中。

- 属于「公共 UI 合同」，一旦开放就要长期维护 props；`plugin-ui/index.ts` 头注释要求
  「加东西前先确认值得长期维护」。建议同时补一条 `verify-purity` 或出口清单检查，
  避免后续误加业务 View。
- 文档要写清「随宿主发布、旧宿主缺导出」，与上游同措辞。

### 3.3 fvqa —— `ctx.command` 新增 `appIcon`

**上游提交**：`2505cbe6f`

**上游改动实质（新增公共合同）**

| 层 | 内容 |
| --- | --- |
| SDK | `PluginCommandApi.appIcon(appName: string): Promise<string \| null>`（`packages/plugins/plugin-sdk/src/command.ts`） |
| IPC | `PLUGIN_EXECUTION_CHANNELS.APP_ICON` |
| 主进程 | 新增 `plugins/app-icon.ts`：只在 `/Applications`、`/System/Applications`、`/System/Applications/Utilities`、`/System/Library/CoreServices`、`~/Applications` 找 `<name>.app`；名字必须匹配 `^[\p{L}\p{N}][\p{L}\p{N} ._+-]{0,63}$`；结果按名字缓存 |
| 权限 | 复用 `agent.command.run`（能探测本机装了什么应用，与 `command.run` 同档） |

**本仓现状：已实现**

- `apps/desktop/src/main/plugins/app-icon.ts:12-35`（`NAME_PATTERN`、`appDirectories`、`resolveAppBundlePath`）
- `apps/desktop/src/shared/plugin-ipc.ts:23`（`APP_ICON: "astravia:plugins:app-icon"`）
- `apps/desktop/src/main/ipc/plugin-execution.ts:75-79`（`capabilityAdapter.pluginIdForSession(..., { permission: "agent.command.run" })`）
- `apps/desktop/src/preload/apis/plugins.ts:408`、`apps/desktop/src/preload/api-types/plugins.ts`
- `apps/desktop/src/renderer/domains/plugins/runtime/plugin-host-apis.ts:638`
- `packages/plugins/plugin-sdk/src/command.ts:74-77`（含注释与权限说明）

**落地难点**：无（已落地）。`app-icon.test.ts` 在 `main/plugins/` 有对应用例（缺省目录与非法名）。

### 3.4 fej0 —— appIcon 不再用 `app.getFileIcon`，改读 `.icns`

**上游提交**：`84fdd1472`

**上游改动实质**：`app-icon.ts` 增 `resolveIconFile()`：用 `plutil -extract CFBundleIconFile raw`
读 `Contents/Info.plist`，在 `Contents/Resources` 找 `.icns`，用 `nativeImage.createFromPath`
读并 `resize({ width: 64, height: 64 })`。原因：`app.getFileIcon` 在 Electron 线程池里调
`NSImage`，macOS 新版本会让主进程直接崩溃。

**本仓现状：已实现**

- `apps/desktop/src/main/plugins/app-icon.ts:38-58`（`resolveIconFile`，含 `/usr/bin/plutil`、
  3000ms 超时、拒绝含分隔符的文件名）
- `:60-75`（`getAppIconDataUrl` 先 `resolveIconFile`，再 `nativeImage` + `resize`）

**落地难点**：无。注意：本仓与上游一样只在 macOS 有意义；非 mac 平台返回 `null` 即可。

---

## 4. B10：宿主 ModelPicker 统一

这一批的共同前提是**上游 `plugin-sdk` 0.3.12 新增的 `ModelPicker` 合同**。
本仓 `packages/plugins/plugin-sdk/src/` 没有 `model-picker.ts`（19 个模块中无此文件），
`packages/plugins/plugin-sdk/package.json` 版本是 `0.3.11`。因此 B10 整体**未开工**。

### 4.1 pan7 —— 新增宿主渲染的 ModelPicker

**上游提交**：`738949766`（合同）、`e4042b282`（`chore(plugin-sdk): 定版 0.3.12`）

**上游改动实质（新增公共合同）**

| 层 | 内容 |
| --- | --- |
| SDK | 新文件 `plugin-sdk/src/model-picker.ts`：`ModelPicker(props)` 通过 `requireBridge().ModelPicker` 渲染宿主组件；`PluginModelPickerProps { value, onChange, reasoning?, emptyOption?, placeholder?, defaultModelKey?, autoSelectDefault?, disabled?, ariaLabel?, variant?, className? }` |
| Host bridge | `PluginHostBridge` 新增 `ModelPicker: ComponentType<PluginModelPickerProps>` |
| 宿主实现 | `apps/desktop/src/renderer/domains/plugins/runtime/PluginModelPicker.tsx`（40 行，渲染共享的 `ModelSelect`） |
| 权限 | **不需要**（只是渲染宿主组件，不读模型清单） |
| 版本 | `0.3.12`；要求 Desktop 0.5.76+ |

**本仓现状：未实现**

- `packages/plugins/plugin-sdk/src/` 文件清单无 `model-picker.ts`；
  `grep ModelPicker packages/plugins/plugin-sdk/src` 零命中。
- `plugin-sdk/package.json:3` 版本 `0.3.11`。
- 插件侧仍各自实现（见 4.4–4.6）。

**落地难点：高（跨包 + 公共合同）**

1. **SDK 合同**：新增 `model-picker.ts`、`host-bridge.ts` 字段、`index.ts` 导出、CHANGELOG、
   版本推进（0.3.12）。旧宿主没有 `bridge.ModelPicker`，`requireBridge()` 必须给出明确错误。
2. **宿主 bridge 装配**：`apps/desktop/src/renderer/domains/plugins/runtime/plugin-host-bridge.ts`
   要新增 `ModelPicker` 实现；`apps/desktop/src/main/plugins/plugin-protocol.ts` 也要透传
   （上游 `738949766` 同时改了这两处）。
3. **依赖 129g**：`ModelPicker` 要「与输入栏同源」，前提是 `ModelSelect` 已经与
   `ModelSelectorView` 共用数据与视图。本仓 `ModelSelect` 仍是自绘下拉（见 4.3），
   先做 ModelPicker 会把「另一份自绘下拉」固化进插件合同。
   **结论：pan7 必须在 129g 之后做。**

### 4.2 r81i —— ModelPicker 支持 `menuClassName`

**上游提交**：`5a0fce85a`

**上游改动实质**：`PluginModelPickerProps` 加 `menuClassName`；宿主 `PluginModelPicker.tsx`
透传给 `ModelSelect`；`ModelSelect` 新增 `menuClassName` 并落到
`classNames={{ trigger, content: menuClassName }}`（菜单在 body 下、默认 `z-50`，
放进更高层浮层会被盖住）。

**本仓现状：未实现**（依赖 pan7）

- `apps/desktop/src/renderer/shared/components/ModelSelect/ModelSelect.tsx` 的
  `ModelSelectProps`（`:20-47`）没有 `menuClassName`。

**落地难点**：低，但**必须与 pan7 同批**，否则要先给 `ModelSelect` 加一个没有消费方的 prop。

### 4.3 129g —— 宿主各处模型选择器与输入栏同源

**上游提交**：`332ea2735`（13 文件，+492/−671）

**上游改动实质**

- 新增 `apps/desktop/src/renderer/shared/components/ModelSelect/useModelPickerModel.ts`（253 行）：
  把「目录 + 收藏 + 推理档位 + 默认模型 + 触发器文案」收敛成一份 hook。
- `ModelSelect.tsx` 从 385 行降到 94 行，改为渲染 `theme-ui` 的 `ModelSelectorView`，
  自己只决定「选中写到哪」与触发器形态。
- `packages/theme-ui/src/chat/ModelSelectorTrigger.tsx` 新增 `ModelSelectorTriggerVariant`
  = `inline | field`（`field`：带边框、12px、推理档位常显）。
- `TeamMemberModelSelector.tsx` 由 98 行减到少量行，改为复用同一份 hook。
- `plugin-ui/index.ts` 增加 `ModelSelectorView` 导出（本仓已有）。

**本仓现状：部分实现**

| 上游改动 | 本仓 | 证据 |
| --- | --- | --- |
| 模型目录/默认值统一 | 已做（数据层） | `apps/desktop/src/renderer/shared/components/ModelSelect/useModelOptions.ts`（129 行）；`ModelSelect.tsx:69` 使用它 |
| `ModelSelect` 改为渲染 `ModelSelectorView` | **未做** | `ModelSelect.tsx` 385 行，仍是自绘 `DropdownMenu` + 分组子菜单（`:1-10` 导入 `DropdownMenu*`；`:69-90` 自管搜索/推理子菜单） |
| `useModelPickerModel` | **未做** | 文件不存在 |
| 触发器 `field` 形态 | **未做** | `packages/theme-ui/src/chat/ModelSelectorTrigger.tsx:6-11` 无 `variant`，只有 `inline` 一套类名 |
| 团队成员选择器复用 | 部分 | `apps/desktop/src/renderer/domains/conversation/connectors/team/TeamModelSelector.tsx:8-11` 复用 `InlineModelPicker` + `ModelConfigurationPopover`，但自己拼 props（`:6-12`） |

**结构差异**

- 本仓把「输入栏视图」拆成 `ModelSelectorView`（面板）+ `InlineModelPicker`（内嵌可搜索体）
  + `ModelConfigurationPopover`（配置浮层）；上游是 `ModelSelectorView` 单入口 + `useModelPickerModel`。
  本仓的拆分对团队/插件场景更灵活，但**数据装配仍分散在三个调用方**。
- 上游用 hook 收敛后的目标是「同一份目录、同一套行为」；本仓目前满足「同一份目录」，
  不满足「同一套行为」（搜索、推理子菜单、空值项各不相同）。

**落地难点：中-高**

- 触及 `apps/desktop` + `theme-ui` 两包，且 `ModelSelect` 有 5 处调用
  （`ImBridgeSettingsView.tsx:166`、`ModelsDefaultModelSection.tsx:42`、
  `KnowledgeBaseSettingsView.tsx:82`、`SchedulerTaskFieldsView.tsx:105`、
  `BatchProjectRuntimeFields.tsx:43`），每处触发器的尺寸/形状不同，`variant="field"` 要能覆盖。
- 需要有回归测试覆盖「设置页选模型 → 写回配置」这条用户路径
  （现有 `ModelsDefaultModelSection.test.tsx` 用 mock 替换了 `ModelSelect`，改结构后要重写）。
- 建议先做 `ModelSelectorTrigger` 的 `variant`（低风险、可独立验证），再把 `ModelSelect`
  切到 `ModelSelectorView`。

### 4.4 v01k —— content-creation 提示词优化模型改用宿主 ModelPicker

**上游提交**：`cc2d14711`（10 文件，+49/−129，删掉 `usePromptOptimizationModels.ts` 59 行）

**上游改动实质**：删掉插件自己的模型清单拉取与原生下拉，改用
`import { ModelPicker } from "@vetta-org/plugin-sdk"`；`plugin.json` 去掉对应权限/依赖；
文案 key 清理。

**本仓现状：未实现**

- `packages/plugins/presets/content-creation/src/prompt-optimization/usePromptOptimizationModels.ts:17-45`
  仍自己 `runtime.promptOptimization.listModels()` 过滤 `input.includes("text")`、自己维护 `selectedModelKey`。
- `PromptOptimizationControl.tsx:1-16` 用 `@astravia-org/ui` 的 `Select` + `Popover` 自绘。
- `plugin.json:7` 仍是 `pluginApiVersion: "^2.0.0"`。

**落地难点**：中。依赖 pan7；本仓还多一层 `ContentPromptOptimizationService`
（`prompt-optimization-service.ts`）持有模型解析逻辑，删 `usePromptOptimizationModels`
前要确认 service 的 `defaultModel` 不再被消费。

### 4.5 qzkn —— chinese-chess 对手模型改用宿主 ModelPicker

**上游提交**：`05df907dd`（删 `components/ModelPicker.tsx` 45 行，`host.ts` / `runtime-context.tsx` 收窄）

**本仓现状：未实现**

- `packages/plugins/externals/chinese-chess/src/components/ModelPicker.tsx:15-40` 仍是原生 `<select>`，
  数据来自 `useChessRuntime().listModels()`（`:13, 17-25`）。
- `plugin.json:7` `pluginApiVersion: "^2.0.0"`。

**落地难点**：低（插件内改动），但**依赖 pan7**；另外象棋是外置插件（`externals/`），
升级 SDK 后要重新打包验证在宿主里的实际加载。

### 4.6 jhbp —— kanban 模型选择改用宿主 ModelPicker

**上游提交**：`efa5addf4`（删 `components/ModelPicker.tsx` 118 行）

**本仓现状：等价实现（路径不同），未走 SDK 合同**

- `packages/plugins/externals/kanban/src/components/ModelPicker.tsx:1-15`：直接
  `import { ModelSelectorView } from "@astravia-org/theme-ui/plugin-ui"`，注释明确说
  「用宿主输入栏的那一个」，并自行适配「跟随默认」哨兵 `INHERIT_KEY` 与推理档位恒空。
- 行为上达到了「与输入栏同源」（同一视图、同一目录）；差异在于：
  - 走的是 `theme-ui/plugin-ui` 合同，不是 `plugin-sdk` 的 `ModelPicker`；
  - 需要插件自己把 `models` 映射成 `ModelSelectorProviderGroup`；
  - 拿不到 SDK 侧的 `reasoning` / `emptyOption` / `autoSelectDefault` 等统一语义（自己实现哨兵）。

**落地难点**：低-中。上游把「插件怎么拼数据」也收进 SDK；本仓若引入 pan7，
kanban 是**最小改动对象**（换 import + 传受控 props），但要保留 `INHERIT_KEY`
语义（映射到 `emptyOption`）。

---

## 5. B11：从外部应用打开

### 5.1 8h4q —— 新增系统插件「从外部应用打开」

**上游提交**：`cca2f7ff3`（新增 19 文件：`packages/plugins/presets/open-in-app/*` + `tenants.json`）

**上游改动实质（新包 + 新用法）**

- 新预设插件 `open-in-app`：`plugin.json` 声明 `ui.slot.header-action` + `agent.command.run`、
  `commands: ["open"]`，`pluginApiVersion ^2.9.0`。
- `src/apps.ts`：应用清单（Finder / VS Code / Cursor / Zed / Xcode / Terminal）+ `open` 参数构造。
- `src/OpenInApp.tsx`：`useAction` 返回 `null` 表示不适用（非 macOS / 远程项目 / 无 cwd）；
  菜单项 `onSelect` 调 `command.run("open", ...)`。
- 它是 `registerHeaderAction` 的**官方示例**（文档里也引用它）。

**本仓现状：已实现（未跟踪，采集末尾出现在工作区）**

- `packages/plugins/presets/open-in-app/plugin.json:1-19`（权限、`pluginApiVersion: "^2.9.0"`、
  `commands: ["open"]`）
- `packages/plugins/presets/open-in-app/src/index.tsx:8-16`（`registerHeaderAction({ id: "open-in-app", order: 100, useAction })`，
  并返回 cleanup）
- `packages/plugins/presets/open-in-app/src/OpenInApp.tsx:76-124`（`useOpenInAppAction`：
  `isMacPlatform` + `isOpenableCwd` 门控、探测缓存、菜单项）
- `packages/plugins/presets/open-in-app/src/apps.ts:16-24`（`EXTERNAL_APPS`）
- `packages/plugins/tenants.json:21, 40`（development / production 均已登记）
- 测试：`test/OpenInApp.test.tsx`、`test/apps.test.ts`；i18n：`locales/{zh,en}.json`

**风险**：该目录 `git status` 为 `??`（未跟踪），创建时间 2026-11-14 21:30–21:32。
落地前要确认：workspace 已被 `packages/plugins/presets/*` 覆盖（`package.json:16`），
但 `bun.lock` 与桌面端打包清单（`prepare-pack` / tenants 生成物）需要跟着更新，
否则安装包里没有这个插件。

### 5.2 r6ne —— 菜单列出全部应用，没装的置灰，图标用应用自己的

**上游提交**：`40b803e70`（`OpenInApp.tsx` +73/−40、`apps.ts` +14/−2）

**上游改动实质**：从「只列已安装」改为「始终列全部」，用 `open -Ra <app>` 静默探测
（`-R` 只查 LaunchServices 不启动），失败的置灰 + `disabled`；图标取
`ctx.command.appIcon(appName)`，缺图标回落到 iconify 类名。

**本仓现状：已实现**

- `apps.ts:31-33`（`buildProbeArgs` → `["-Ra", appName]`，注释说明不会启动）
- `OpenInApp.tsx:40-74`（`detectApps()`：`alwaysAvailable`（Finder）直接可用，其余 `command.run("open", buildProbeArgs(...))`；
  同时并行取 `appIcon`，失败回落）
- `OpenInApp.tsx:103-124`（`EXTERNAL_APPS.map`：`disabled: !installed`、
  `icon: <img src={icon} … className={installed ? "size-4" : "size-4 opacity-50 grayscale"}>`）

**落地难点**：无（已落地）。注意 `detectApps()` 是**模块级 promise 缓存**，
在 `setHostApis` 里重置；热重载后必须重新探测（对应 5.3）。

### 5.3 cttc —— 激活清理只释放自己的接口

**上游提交**：`9a56bd05a`

**上游改动实质**：新增 `releaseHostApis(command)`：只有 `commandApi === command` 时才清空；
`activate` 返回 cleanup 而非写 `deactivate()`。原因：宿主重试激活时新激活先于旧
`deactivate` 完成，无条件清空会抹掉新登记的接口，按钮整个消失。

**本仓现状：已实现**

- `packages/plugins/presets/open-in-app/src/OpenInApp.tsx:18-37`（`setHostApis` / `releaseHostApis`，
  注释与上游同义）
- `packages/plugins/presets/open-in-app/src/index.tsx:16`（`return () => releaseHostApis(ctx.command)`；
  无 `deactivate`）

**落地难点**：无。这一条与 `docs/plugin/styling-and-pitfalls.md`「清理副作用」一节的
「不要用模块级可变单例在新旧实例之间传递运行时所有权」是同一条约束，插件文档已覆盖。

---

## 6. B12：MCP

### 6.1 llr7 —— 桌面端与 Agent 能力接入 sse 传输

**上游提交**：`7c58c7313`（26 文件）

**上游改动实质（跨 6 层）**

| 层 | 内容 |
| --- | --- |
| Schema | 配置 `type: http \| sse`；`sse` 只允许 `protocolMode: legacy`（`assertSseProtocolMode`） |
| 能力 | `capability-sdk` 的 `MCP_SERVER_TYPES` 加 `SSE`；`mcp.query` / `mcp.manage` 接受 `sse` |
| 桌面主进程 | `mcp-config-validation.ts` 的 `SSE_SERVER_KEYS`（url/headers/oauth*，不含 `managedRuntimeId`）；`mcp-settings-service.ts` 的 `buildSseConfig`（从 http 改成 sse 不能继承受管 runtime） |
| 渲染层 | `McpServerForm` 传输类型三选一；i18n 增 `sse` / `sseUrl` |
| 预设 | `builtin-mcp-presets` 增 sse 条目 |
| 文档 | ADR（上游 0154）+ capability catalog 重生成 |

**本仓现状：已实现**

| 上游 | 本仓证据 |
| --- | --- |
| schema 接受 sse 且限制 protocolMode | `packages/runtime-mcp/src/config/schemas.ts:37`（`Type.Union([Literal("http"), Literal("sse")])`）、`:70-75`（`assertSseProtocolMode`：sse 只允许 legacy） |
| 能力类型 | `packages/capability-sdk/src/domain/mcp.ts:14-19`（`MCP_SERVER_TYPES.SSE` + 注释） |
| 桌面校验 | `apps/desktop/src/main/mcp-config-validation.ts:98-105`（`SSE_SERVER_KEYS` 分支，无 `managedRuntimeId`） |
| 主进程 upsert | `apps/desktop/src/main/mcp/mcp-settings-service.ts:102-115`（`buildSseConfig`，只在同为 sse 时沿用旧值） |
| 表单 | `apps/desktop/src/renderer/domains/settings/components/McpServerForm.tsx:74`（SSE 选项）、`:263-271`（`sseUrl` 输入） |
| SDK 合同 | `packages/plugins/plugin-sdk/src/official.ts:157, 165, 191-192`（`type: "http" \| "sse" \| "stdio"`） |
| 预设 | `apps/desktop/src/renderer/domains/settings/mcp/builtin-mcp-presets.ts`（3 处 sse） |
| i18n | `apps/desktop/src/shared/i18n/locales/zh/settings.json:582, 653, 658-659` |

**结构差异**：本仓把「远程 MCP」拆成 `http`（支持 `modern` / `stateless` / `auto`）与
`sse`（只 legacy）两族，比上游当期的二选一更细；`sse` 的迁移约束与上游一致。

**落地难点**：无（已落地）。残留：能力目录 `docs/capabilities/catalog.json` 与
`packages/plugins/docs` 是否同步（上游在同提交重生成 catalog），建议核对一次。

### 6.2 9d56 —— 运行时支持旧式 HTTP+SSE 传输

**上游提交**：`db2024a88`（含新测试 `test/mcp/sse-mcp-client.test.ts` 134 行）

**上游改动实质**：`runtime-node` 的传输适配层按 `type` 选 `SSEClientTransport` 或
`StreamableHTTPClientTransport`；OAuth session 适配 sse；`protocolMode` 默认值随类型变化。

**本仓现状：已实现**

- `packages/runtime-node/src/mcp/transports/http/sdk-session-adapter.ts:4`（`import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"`）
- `:21-22`（`McpHttpSdkTransportKind = "streamable-http" | "sse"`）
- `:67-74`（`kind === "sse" ? new SSEClientTransport(url, transportOptions) : …`）
- `packages/runtime-node/src/mcp/transports/http/http-mcp-client.ts`（选择传输）

**落地难点**：无。

### 6.3 dqpd —— `mcp.manage` 支持指定装到全局或项目层

**上游提交**：`46f2f3dbb`（34 文件，+约 1100 行；新增 ADR-0153、`mcp-approval-target.ts`）

**上游改动实质（公共合同 + 多层写入）**

| 项 | 内容 |
| --- | --- |
| 能力输入 | 新增 `MCP_SCOPES = { GLOBAL, PROJECT }` 与 `mcpTargetFields = { scope?, cwd? }`，加到 `list` / `get` / `upsert` / `set-enabled` / `remove` 的输入 |
| 输出 | `mcpServerSummary` / `mcpServerDetail` 增 `scope?` 与 `readOnly?`（来自 `.mcp.json` 的条目只读） |
| 语义 | 不传 = 只碰全局；`scope: "project"` 必须带本机 `cwd`，远程项目拒绝；全局与项目同名时必须指明 `scope` |
| SDK | `official.mcp.upsert(name, data, target?)` 等；`PluginOfficialMcpServerSummary` 增 `scope/readOnly` |
| IPC | `apps/desktop/src/preload/api-types/plugins.ts` 透传 target |
| 审批 | 新增 `shared/action-approval/manage/mcp/mcp-approval-target.ts`；三个审批弹窗显示配置落点并把 `scope` 原样带回 |
| 主进程 | `mcp-settings-service.ts` 大改：按层读写、同名冲突检测、`.mcp.json` 只读拒绝 |

**本仓现状：未实现**

- 能力域：`packages/capability-sdk/src/domain/mcp.ts` **无 `scope` / `readOnly` 任何字样**
  （`grep -c scope` = 0）。`mcpServerSummaryType` / `mcpServerDetailType` 仍只有
  `name/type/disabled/command/url/...(见 :29-66)`。
- SDK：`packages/plugins/plugin-sdk/src/official.ts:558-565` 仍是
  `upsert(name, data)` / `setEnabled(name, enabled)` / `remove(name)`，无 target 参数；
  `PluginOfficialMcpUpsertData`（`:178-199`）无 `scope`。
- 动作层：`packages/plugins/presets/astravia-actions/src/domains/mcp.ts:14-17`
  `McpManageInput` 只有 `operation/name/data/enabled`；`querySchema`（`:19-27`）的 `list`
  分支 `additionalProperties: false` 且不含 `cwd`；`list` 直接
  `ctx.official.mcp.list()`（`:139`）拿不到层级信息。
- 审批：`apps/desktop/src/renderer/shared/action-approval/manage/mcp/` 只有
  `McpUpsertApproval.tsx` / `McpRemoveApproval.tsx` / `McpSetEnabledApproval.tsx`，
  **无 `mcp-approval-target.ts`**，弹窗不显示配置落点、也不回传 `scope`。

**结构差异**：本仓的项目层配置文件是 `.astravia/mcp.json`（`docs-site` 文档 :8-10 与
`FileMcpConfigSourceOptions.projectConfigPath` 都按这个），上游是 `.vetta/mcp.json`；
层级语义可以直接照搬，路径常量不要照抄。

**落地难点：高（本批最重的一条）**

1. **能力合同**：改 `capability-sdk/src/domain/mcp.ts` 的 5 个输入 schema + 2 个输出 schema，
   并重生成能力目录（本仓 `docs/capabilities/catalog.json` 与相关快照测试）。
2. **主进程**：`mcp-settings-service.ts` 现在只有一份 `mcpServers` 视图，要按层拆；
   `.mcp.json` 条目要能标记 `readOnly` 并在写操作时拒绝。这部分与已落地的 ro8e
   （`FileMcpConfigSource.loadProject()` 已合并 compat 文件，`file-config-source.ts:41-47`）
   需要打通——**合并后在内存里丢失了「这条来自 .mcp.json」的身份**，要补 origin 标记。
3. **IPC + 审批**：`preload/api-types/plugins.ts`、三个审批组件、i18n（中英）都要加，
   否则用户看不到装到哪一层（上游专门为此加了 `mcp-approval-target.ts`）。
4. **动作层文案**：`astravia-actions` 的 `mcp.manage` description / help guidance 要同步，
   否则模型不知道 `scope` 存在（B13 的 skill 依赖这句话）。
5. **测试**：上游在 `mcp-settings-service.test.ts` 加了 158 行、新增 `mcp-project-config.test.ts` 79 行；
   本仓需要等价的层级读写与同名冲突用例。

### 6.4 ro8e —— 项目层读取时并入根目录 `.mcp.json`

**上游提交**：`1b2487f3a`（+201/−5，含 ADR-0152 与文档站中英两篇）

**上游改动实质**

- `FileMcpConfigSource` 增 `compatProjectConfigPath`：项目层 = `compat` ⊕ `native`，
  **同名整体替换**（不做字段合并，避免拼出谁都没写过的 command/args 组合）。
- `${VAR:-default}` 语法支持；`${PROJECT_ROOT}` 指向项目根。
- `.mcp.json` **永不被改写**（后续 dqpd 用 `readOnly` 暴露给用户）。
- 打开含 `.mcp.json` 的仓库会启动其中的本机命令 → 文档站补「只在信任的仓库使用」警告。

**本仓现状：已实现（代码），文档站未同步**

| 上游 | 本仓证据 |
| --- | --- |
| `compatProjectConfigPath` 选项 | `packages/runtime-node/src/mcp/config/file-config-source.ts:11-17`（注释「只读，读取时并入项目层，同名以 projectConfigPath 为准」） |
| 同名整体替换 | `:41-47`（`{ ...compat.mcpServers, ...(native?.mcpServers ?? {}) }`，注释说明不做字段合并） |
| `${VAR:-default}` | `:176-184`（`replaceVariables`，含 `PROJECT_ROOT` 与 `:-` 默认值） |
| 宿主传入 `.mcp.json` 路径 | `packages/runtime-node/src/mcp/supervisor.ts:51`（`compatProjectConfigPath: join(options.projectRoot, ".mcp.json")`） |
| 文档站说明 | **缺**：`apps/docs-site/content/docs/product/mcp.mdx:8-10` 只提 `.astravia/mcp.json`，无 `.mcp.json` 合并与信任警告 |

**落地难点**：代码无；文档需补一节（中英），并说明「同名以 `.astravia/mcp.json` 为准、
`.mcp.json` 不被改写、`${VAR:-默认值}` 可用、只在信任的仓库使用」。

---

## 7. B13：skill

### 7.1 6d2h —— install-ability 不读配置文件、不主动探测可执行文件

**上游提交**：`4a5fec47e`（单文件 `packages/skill-presets/install-ability/SKILL.md`）

**上游改动实质**

- 通用前置新增一条：**查看已装内容只用 `*.query` 动作**（`mcp.query` / `skills.query` /
  `plugins.query`），不要读 `~/.vetta/agent/mcp.json` 等配置文件——里面有明文密钥，
  读进来就进了上下文并发给模型供应商；查询动作返回值已脱敏。
- 「校验」一条改写：**不要主动启动用户的可执行文件做握手探测**，`get` 能返回配置就算装好；
  只有用户要求排错、或工具确实起不来时才手跑 `command args`。

**本仓现状：未实现**

- `packages/skill-presets/install-ability/SKILL.md:26-29`（「通用前置」四条：只在明确要求时安装 / 写操作走审批 / 禁止改注册表 / 第三方来源确认）无「只用查询动作」这条。
- `:142` 仍是「起不来时，先把 `command args` 在终端手跑一次看报错」，
  缺少「不要主动探测」的前置约束。
- 本仓对应路径是 `~/.astravia/agent/mcp.json`（`:28` 已写对），说明这条没有被套用。

**落地难点**：低（纯文档/skill 内容，无代码）。但这是**安全相关**的约束
（明文密钥进上下文），建议单独一次提交并同步 `ability.json` 的 skill 版本。

### 7.2 4b7x —— install-ability 安装 MCP 前先问清全局还是项目

**上游提交**：`d2c6a28e4`（7 文件：SKILL.md + 文档站中英 + 发布说明）

**上游改动实质**

- 分类表 MCP 行改为「先定装到哪一层（§1.1），再 `mcp.manage upsert`（§4）」。
- 新增 **§1.1 装到哪一层（scope）**：没说清且有项目时先问；说清了不重复问；无项目或装插件时不问。
- 项目层密钥只允许 `${VAR}` 引用；报告里写明落在哪一层；说明市场 skill 目前只能装全局。
- §4 补：`mcp.query list` 会同时列全局与项目并标 `scope`，`.mcp.json` 条目 `readOnly:true` 不可改；
  全局与项目同名必须指明 `scope`，否则报错——这时问用户，不要替他猜。

**本仓现状：未实现，且被 dqpd 阻塞**

- `SKILL.md:20` 分类表仍是 `mcp.manage upsert`（§4），无「先定层级」。
- 全文无 `scope` 相关章节（`grep "装到哪一层"` = 0）。
- `:143` 的停用/删除只写「`mcp.manage set-enabled` / `remove`」，无同名需指明的约束。
- **前置依赖未满足**：`mcp.manage` 本身还不接受 `scope`（见 6.3），
  现在写进 skill 会让模型传一个被 `additionalProperties: false` 拒绝的字段。

**落地难点：中（顺序强相关）**

必须 **dqpd → 4b7x → 6d2h** 这个顺序：

1. `dqpd` 给 `mcp.manage` / `mcp.query` 加 `scope` / `cwd` / `readOnly`，并补审批弹窗落点；
2. `4b7x` 才能写「先问层级 + `${VAR}` + 同名指明」；
3. `6d2h` 的「只用查询动作」依赖 `mcp.query` 返回脱敏后的 `scope` 视图（否则用户看不出装在哪层）。

另外本仓文档站（`apps/docs-site/content/docs/product/mcp.mdx`）没有上游那样的
「让 Agent 帮你装：全局还是项目」小节，需要随 4b7x 一起补中英两篇。

---

## 8. 交叉发现（比单条状态更重要）

### 8.1 ADR 状态列与源码冲突（3 处）

| ADR | 原记载 | 源码事实 | 建议 |
| --- | --- | --- | --- |
| ADR-0157 `44o7` | 「部分对齐（…页头浮层化需 app-shell 结构变更，未做）」 | 沉浸式已落地：`pageHeaderImmersiveAtom` + `MainContentFrame.headerOverlay` + mask | 改为「已对齐（B8）」 |
| ADR-0157 `hhe6` | 「不适用（本仓页头不是浮层…）」 | `MessageFeedLayoutTopInset` 已按上游最终态实现 | 改为「已对齐（B8）」 |
| ADR-0165「后果 / 已知限制」 | 「沉浸式顶栏只做了消息流渐隐，页头浮层化未做」 | 同上 | 同步修正 0165 的「保留/放弃」论证 |

这三处是**文档落后于实现**，不是实现缺失。按 AGENTS.md「文档与实现冲突时先核实并指出」，
更新 0157 状态列时必须一并改 0165，否则两份 ADR 会互相矛盾。

### 8.2 ADR-0157「下一步」指向了错误的 ADR

ADR-0157 第 615-617 行写「会话域（chat 分组，ADR-0165）与 MCP / 插件合同（… ADR-0166）」。
但本仓 `docs/adr/0166-resident-sidebar-and-activity-panel-width.md` 是**常驻侧栏与活动面板宽度**，
不是 MCP/插件合同。B9–B13 目前**没有对应的决策记录**。建议新建一份
（例如 ADR-0167「插件模型选择器与 MCP 安装层级」）承载 pan7/r81i/129g/dqpd 的取舍。

### 8.3 plugin-sdk 版本落后，且 Unreleased 里有公共合同

- 本仓：`packages/plugins/plugin-sdk/package.json:3` = `0.3.11`；
  `CHANGELOG.md:5-7` 的 `[Unreleased]` 里已有 `registerHeaderAction`（要求 Plugin API `^2.9.0`）。
- 上游：`0.3.12`（ModelPicker）、`0.3.13`（顶栏动作定版 + 清单权限合同测试）。
- 影响：本仓插件若声明 `pluginApiVersion: ^2.9.0`（`open-in-app` 已经这么写），
  但宿主 SDK 包仍是 0.3.11，**npm 上的 SDK 版本与宿主能力不对应**。
  B10 落地时应该一次性把版本推到 0.3.13 等价位置，并补 `test/manifest-permissions.test.ts`
  那样的清单权限合同测试（上游 `d242d54e5` 加的）。

### 8.4 发布说明已经写了未落地的条目

`.github/release-notes/v0.5.94.md` 首条是「新增「从外部应用打开」系统插件…」，
其中「插件设置里可以单独关掉它」这句目前没有实现依据：
`packages/plugins/presets/open-in-app/plugin.json` 没有 settings 声明，插件也没有设置面板。
其余描述（列出全部应用、`open -Ra` 探测、图标用应用自己的、远程项目不显示）与代码一致。
建议落 B11 收尾时补设置开关，或把这句从发布说明删掉。

### 8.5 依赖关系图（决定批次顺序）

```
3cnb(useActiveConversation)  ── 独立，最小
129g(ModelSelect→ModelSelectorView, trigger variant)
        └→ pan7(plugin-sdk ModelPicker + host bridge)
                ├→ r81i(menuClassName)
                ├→ v01k(content-creation)
                ├→ qzkn(chinese-chess)
                └→ jhbp(kanban，当前为等价实现，可最后做)
egco(plugin-ui 4 个导出 + 插件文档)  ── 独立于 B10
dqpd(mcp scope/cwd/readOnly + 审批落点)
        └→ 4b7x(skill 先问层级)
                └→ 6d2h(skill 只用查询动作)
ro8e 文档站补充  ── 独立，纯文档
```

---

## 9. 建议的落地顺序与验证口径

| 序 | 条目 | 预估 | 关键验证 |
| --- | --- | --- | --- |
| 1 | 3cnb 剩余（派生 atom + `useActiveConversation`） | 小 | `plugin-header-action.test.tsx` 现有用例 + 新增「流式期间探针不重发」断言 |
| 2 | ro8e 文档站补充 | 小 | 文档链接/命令核对；无代码变化 |
| 3 | egco（plugin-ui 4 导出 + 文档两节） | 小-中 | `bun run check:quick`；`theme-ui` purity 校验；插件侧 import 冒烟 |
| 4 | 6d2h（skill 两条约束） | 小 | SKILL.md 内容评审；`ability.json` 版本 |
| 5 | 129g（trigger variant → ModelSelect 切视图） | 中-高 | 5 处调用点的组件测试：默认模型写回、定时任务表单、知识库设置、审批卡、批量任务 |
| 6 | pan7 + r81i（SDK 合同 + host bridge + 版本） | 高 | SDK 单测（`model-picker.test.ts` 等价物）、host bridge 装配测试、插件在宿主里的实际渲染 |
| 7 | v01k / qzkn / jhbp 三个插件迁移 | 中 | 各插件 `vitest` + 宿主内加载冒烟 |
| 8 | dqpd（能力 + IPC + 审批 + 主进程分层） | 高 | 层级读写、同名冲突、`.mcp.json` 只读拒绝、审批回传 `scope`、catalog 重生成 |
| 9 | 4b7x（skill + 文档站） | 小-中 | skill 内容与 dqpd 实际字段一致（不能写不存在的入参） |
| 10 | B11 收尾（设置开关或改发布说明） | 小 | 发布说明与插件清单一致 |

批次边界的两个硬约束：

- **pan7 必须在 129g 之后**，否则会把「第二套自绘下拉」固化进 SDK 公共合同。
- **4b7x/6d2h 必须在 dqpd 之后**，否则 skill 会教模型传一个被 schema 拒绝的字段。

## 10. 未覆盖与残余风险

- **并发改动**：采集期间 `open-in-app` 与部分顶栏文件在变。B11 的三条基于 21:31 快照，
  提交前需重新核对 `git status` 与 `bun.lock`。
- **未逐行核对的上游伴随改动**：`7c58c7313` 的 `docs/capabilities/catalog.json` 重生成、
  `46f2f3dbb` 的能力目录 128 行变更，本仓对应生成物是否同步未验证（属于生成文件，
  应在 dqpd 落地时交给生成脚本）。
- **类型检查已归零（主控独立复跑确认）**：本报告写入时 `tsc` 因内存不足被 V8 abort，工作区那批
  未提交改动**从未经过一次完整的类型检查**，首测 56 条 / 25 个文件。清零后 `tsgo --noEmit -p
  apps/desktop/tsconfig.json` 为 **exit 0、0 条错误**；同时核对未改 tsconfig、未新增 `any` /
  `@ts-ignore`（全仓 0 处）、未排除任何文件。

  其中三条不是类型洁癖而是**用户可见缺陷**，已按缺陷修：`fileEditor.locate`、`fileExplorer.newMenu`、
  `atPanel.referenceDirectory` 与权限 `shell.open-external-app` 的文案缺失，缺键时界面会直接渲染出
  原始键名。另有两处顺带修出的行为缺陷：打开旧式 SSE 服务器编辑时传输方式被写成 `http`（现保留 `sse`）；
  `FsFileRef` 未声明 `isDirectory` 而远端分支一直在返回它，调用方只能靠 `=== true` 猜。

- **UI 实机未验证**：沉浸式顶栏、收纳第二胶囊、`OPAQUE_GLASS` 的实际观感需要桌面壳核验
  （用户已安排在完成后启动开发环境）。
- **移动端不在范围**：本报告只覆盖桌面端与相关包；`apps/mobile/*` 未核对。
