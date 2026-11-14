# ADR-0157 登记表 / ADR-0168 / ADR-0166 抽验报告

审计对象：ADR-0157「0.5.72–0.5.81 全量对齐登记」的状态列，以及声称已落实的
ADR-0168（宿主模型选择器）、ADR-0166（常驻侧栏与活动面板宽度）。
审计方式：只读源码 + 定向运行用例，未启动 Desktop、未访问真实 Provider。

**结论：不通过。** 8 条缺陷，其中 3 条为阻断级。

> **后续状态（本轮已处理）**：D1–D6 的代码与用例均已落地并独立复跑通过（见 ADR-0170 的「实施记录」）；
> D7–D9 是文档口径问题，已在 ADR-0157 §15–§17 与 ADR-0160 / 0168 中改正。
> 本报告保留为当时的判定依据，逐条结论不再随代码变化而改写。

---

## 0. 证据快照与并发警告

| 项 | 值 |
| --- | --- |
| 本仓 HEAD | `367cb3ea0` |
| 工作区 | 未提交改动约 300 项 |
| 审计时间 | 2026-11-14 23:05–23:20 |
| ADR-0157 快照 | mtime `23:11:52`（审计期间被其他 Agent 改写，本报告以该时刻内容为准） |

审计期间同时出现 `docs/adr/0172-adopt-reference-brand-identity.md` 新增、ADR-0157 第
§15 节被追加。**§15 的结论来自 21:20–21:45 的旧证据报告，与本报告读取的代码不一致**，
见 D10。后续复核请以 file:line 重新取证，不要以状态列自证。

---

## 1. 阻断级缺陷

### D1【P0】模型菜单「打开时当前模型对齐到顶部」仍未接线，登记表却写「已对齐」

- 声明：[0157 第 222 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/adr/0157-reference-alignment-0.5.72-0.5.81.md>)
  「模型选择菜单列表边缘渐隐，打开时当前模型对齐到顶部 → 已对齐（B3 续）」。
- 实际：[ModelSelectorView.tsx 第 171 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/chat/ModelSelectorView.tsx>)
  声明 `const modelListRef = useRef<HTMLDivElement>(null)`，
  [第 199–204 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/chat/ModelSelectorView.tsx>)
  在读 `modelListRef.current?.querySelectorAll(...)`，但该 ref **从未挂到任何 DOM 节点**
  （全文件无 `ref={modelListRef}`），`ModelSelectorMenuPanel` 的 props 也不接受 ref
  （[第 230–250 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/chat/ModelSelectorMenuPanel.tsx>)）。
  于是 `querySelectorAll` 恒为空、`scrollIntoView` 恒不执行。
- 同一处连带失效：[第 217–222 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/chat/ModelSelectorView.tsx>)
  搜索框 `↓` 键同样读这个 ref，永远拿不到 `target`，等同于没有该快捷键。
- 这正是 [ADR-0170 §3](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/adr/0170-alignment-audit-revisions.md>)
  已给出的修法：「接受要露出的模型 key，内部按行高与下标算 scrollTop」，但代码里不存在
  `revealKey` 一类入参，说明该修订**未实施**。
- 影响：超过 60 行窗口化后，当前模型大概率不在已挂载区间内，打开菜单就停在列表顶部，
  用户需要自己找；长列表下这正是该功能的唯一用途。
- 修法：按 ADR-0170 §3 改为「传 key → 算 `scrollTop` → `listRef.scrollTop = ...`」；
  删除已死的 `modelListRef` 与 `MODEL_ITEM_SELECTOR` 查询路径。
- 验证：新增用例「选中模型位于第 80 行、打开面板后该行可见」，并在删除 ref 后仍通过。

### D2【P0】`theme-ui` 的管理会话组件用例仍然无法运行，「验证」一节不成立

- 声明：[ADR-0170 §1](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/adr/0170-alignment-audit-revisions.md>)
  「需要 testing-library 的面板级用例移到 `apps/desktop`」。
- 实际：[ManageSessionsSplashView.test.tsx 第 2 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/project/ManageSessionsSplashView.test.tsx>)
  仍 `import { render, screen, waitFor } from "@testing-library/react"`，文件仍在 `theme-ui` 内。
- 实测（`packages/theme-ui` 目录）：

  ```text
  bun ../../scripts/quality/run-vitest.mjs --run src/project/ManageSessionsSplashView.test.tsx
  → Test Files 1 failed (1) / Tests no tests
    Failed to resolve import "@testing-library/react"
  ```

- 影响：登记表「管理会话」5 条（虚拟列表、按需加载、标签页、删除落点、行样式）唯一的
  组件级验证不存在；`bun run test:impact` 一旦选中该文件必红。
- 修法：按 ADR-0170 §1 迁移到 `apps/desktop`，或改成 `react-dom/client` + `act` 与包内既有写法一致。

### D3【P0】`useManageSessionsModel.test.tsx` 两条用例稳定失败

- 实测（`apps/desktop` 目录）：

  ```text
  bun ../../scripts/quality/run-vitest.mjs --run src/renderer/domains/project/hooks/useManageSessionsModel.test.tsx
  → Tests 2 failed | 2 passed (4)
    [134] expected 'conversation:/b.jsonl' to be 'conversation:/a.jsonl'
    [186] expected [] to have a length of 3
  ```

- 根因与 [alignment-review-0160-0166.md 阻断 B2](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/dev/alignment-review-0160-0166.md>)
  一致：桩件没有模拟「删除后列表变短」，且用例用的是普通项目而非「对话」档
  （[useManageSessionsModel.ts 第 91 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/project/hooks/useManageSessionsModel.ts>)
  `canTag = isDefault && !isClaw`）。
- 影响：ADR-0170 §2 声称已按设计改写用例，实际一字未动。
- 修法：桩件删除后真的缩短 `rows`；标签页用例改用「对话」档，并补一条「普通/Claw 无标签页」的反向断言。

---

## 2. 重要缺陷

### D4【P1】能力页横幅仍随安装进度重排并跳回第一张（ADR-0170 §4 未实施）

- 声明：登记表「安装进度刷新不再重算目录并重渲染全部卡片 → 已对齐（B6）」。
- 实际：[useAbilitiesModel.ts 第 184–195 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/abilities/hooks/useAbilitiesModel.ts>)
  的 `bannerIcons` 依赖是 `[allItems]`，而 `allItems` 依赖 `operationProgressById`
  （[第 118–142 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/abilities/hooks/useAbilitiesModel.ts>)）。
  [AbilitiesBanner.tsx 第 68 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/abilities/components/AbilitiesBanner.tsx>)
  据此 `shuffleIcons`，[第 99–101 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/abilities/components/AbilitiesBanner.tsx>)
  `useEffect(() => setActive(0), [pool])`。
- 影响：安装期间每个进度 tick 都会重新洗牌并回到第 1 张，用户点到第 3 张会被不断弹回。
- 修法：按 ADR-0170 §4 用「id/标题/图标/简介」签名 memo，而不是 `allItems` 引用。

### D5【P1】矮窗口下列表选中行会滚出视口（ADR-0170 §5 未实施）

- 声明：ADR-0170 §5「按容器实测高度算可见行数与 overscan」。
- 实际：[manage-sessions-range.ts 第 46 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/project/manage-sessions-range.ts>)
  仍是常量 `MANAGE_SESSIONS_LIST_HEIGHT = 420`，
  [ManageSessionsSplashView.tsx 第 233、249 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/project/ManageSessionsSplashView.tsx>)
  直接用它当 `viewportHeight`；容器实际是 `max-h-[min(420px,56vh)]`。
- 影响：窗口高度 < 750px 时 56vh < 420px，按 420 算出的可见区间比真实视口大，
  `manageSessionsScrollTopFor` 会让选中行落在可视区之外，方向键继续走也回不来。
- 修法：用 ResizeObserver 读容器高度（或读 `56vh` 对应的像素值），与窗口 resize 一起重算。

### D6【P1】「清空默认模型」没有清掉新会话读取的那份记忆（ADR-0170 §6 未实施）

- 声明：ADR-0170 §6「清空默认模型时一并删除 `astravia-selected-model`」。
- 实际：[useModelsSettingsModel.ts 第 403–419 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/settings/components/useModelsSettingsModel.ts>)
  只在 `next` 为真时 `localStorage.setItem(...)`，`next === undefined` 时直接跳过，
  旧键原样保留。
- 影响：设置页显示「未设置」，新会话仍按记忆的模型发消息——正是 ADR-0170 描述的缺陷。
- 修法：`else` 分支 `localStorage.removeItem("astravia-selected-model")`。

### D7【P1】从外部应用打开：登记表写「未安装置灰、已对齐」，与 ADR-0171 及实现相反

- 声明：[0157 第 449 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/adr/0157-reference-alignment-0.5.72-0.5.81.md>)
  「菜单列出全部应用，没装的置灰…… 已对齐（B2 续）」。
- 实际：[ADR-0171 第 27–30、52–53 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/adr/0171-open-in-app-via-host-shell.md>)
  明确写「不存在『列出全部应用、未安装的置灰』这一形态…… 这一条要写进 ADR-0157 的状态列，
  **不能记成「已对齐」**」。
  代码侧：[shell.ts 第 11–21 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/plugins/plugin-sdk/src/shell.ts>)
  的 `PluginExternalApplication` 只有 `id/name/kind/iconUrl/isDefault`，没有表示「未安装」的字段；
  [OpenInApp.tsx 第 110–129 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/plugins/presets/open-in-app/src/OpenInApp.tsx>)
  只渲染 `listExternalApplications` 返回的已安装应用。
- 结论：这是**有意差异**，登记表状态必须改成「等价实现（有意差异）」并注明原因，
  不能继续写「已对齐 + 未安装置灰」。
- 附加：同一节第 456 行称「按跨平台改写，见 ADR-0158 第三步」，ADR-0158 确有该节，
  但该节的取舍与 ADR-0171 重复，建议只保留一处引用。

### D8【P1】`SplashPanel` 抽取条目标「已对齐」，同一份文档的 §13 却写「未做」

- 声明：[0157 第 410 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/adr/0157-reference-alignment-0.5.72-0.5.81.md>)
  「把 ⌘K 面板的外壳抽成公共 SplashPanel → 已对齐（B4：新增 SplashPanel，⌘K 面板迁移见 0160 §1 未做说明）」。
- 实际：[CommandMenuView.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/overlays/CommandMenuView.tsx>)
  没有引用 `SplashPanel`，仍是自己的外壳；[0157 第 197 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/adr/0157-reference-alignment-0.5.72-0.5.81.md>)
  也把这条列为「未做」。
- 另外 [ADR-0160 §1](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/adr/0160-sidebar-project-alignment.md>)
  引用「ADR-0157 的 `xa9m`」——该 ID 在 ADR-0157 中不存在（登记表已无条目 ID 列）。
- 修法：状态改「部分对齐（原语已抽出，⌘K 外壳未迁移）」，并修掉悬空引用。

### D9【P1】ADR-0168 零实现：SDK 合同、宿主收敛、三个插件迁移都不存在

逐项核对 ADR-0168 的决策：

| 决策 | 声明 | 实际 |
| --- | --- | --- |
| §1 宿主收敛 | `useModelPickerModel` + `ModelSelect` 改渲染 `ModelSelectorView` | 全仓无 `useModelPickerModel`；[ModelSelect.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/shared/components/ModelSelect/ModelSelect.tsx>) 仍是 385 行自绘 `DropdownMenu` |
| §1 触发器形态 | `variant: "inline" \| "field"` | 无此参数 |
| §2 SDK `ModelPicker` | 新增 `model-picker.ts` | 文件不存在（`packages/plugins/plugin-sdk/src/` 下无该文件） |
| §3 版本推进 | `0.3.11 → 0.3.13` 等价档 | [package.json 第 3 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/plugins/plugin-sdk/package.json>) 仍是 `0.3.11` |
| §4 三个插件 | 改用 SDK `ModelPicker` | 三者仍各自实现：`kanban/src/components/ModelPicker.tsx`、`chinese-chess/src/components/ModelPicker.tsx`、content-creation 自绘 |

- 「验证」一节的四条（五条调用路径用例、SDK 桥接单测、三个插件 vitest）当前都不存在；
  [ModelsDefaultModelSection.test.tsx 第 17–18 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/settings/components/ModelsDefaultModelSection.test.tsx>)
  仍 `vi.mock("@shared/components/ModelSelect")`。
- 严重性说明：ADR-0157 把这 6 条正确记为「待对齐」，因此**不是假「已对齐」**；但 ADR-0168
  的状态是「已接受」且「验证」写成完成态，容易被后续批次当成已落地。建议状态改为
  「已接受，未实施」，并把验证段移入「实施后的验收标准」。
- 关联：`registerHeaderAction`（要求 Plugin API `^2.9.0`）与 `ctx.shell`（`^2.10.0`）
  已进入源码，但 `plugin-sdk` 版本仍是 `0.3.11`、只在 CHANGELOG `[Unreleased]` 里描述，
  与 ADR-0168 §3 要解决的「包版本与宿主能力不对应」是同一个待办。

---

## 3. 文档一致性缺陷

### D10【P2】§15 复核表有两处**反向**误判（把已实现的判成未做）

[0157 第 628–629 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/adr/0157-reference-alignment-0.5.72-0.5.81.md>)：

| 条目 | §15 结论 | 代码事实 |
| --- | --- | --- |
| chat `2ux7` | 「`useActiveConversation` 仍订阅整份会话」→ 部分对齐 | [plugin-host-bridge.ts 第 795–803 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/plugins/runtime/plugin-host-bridge.ts>) 已分别订阅 `activeSessionRuntimeIdAtom` / `activeSessionCwdAtom` / `activeSessionPathAtom` / `isStreamingAtom` / `selectedModelAtom`，再用 `useMemo` 组装 |
| plugin `egco` | 「`plugin-ui` 四个设置组件与组件速查未开」→ 部分对齐 | [plugin-ui/index.ts 第 29–32 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/plugin-ui/index.ts>) 已导出 `MotionSelect` / `SettingSection` / `SettingRow` / `SettingHeading`；[exports.test.ts 第 19–22 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/plugin-ui/exports.test.ts>) 有出口清单守卫；[styling-and-pitfalls.md 第 198、218 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/plugin/styling-and-pitfalls.md>) 两节都在 |

两者都在 22:26 前后完成，而 §15 沿用的是 21:20–21:45 的证据快照。相应地，
[第 436 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/adr/0157-reference-alignment-0.5.72-0.5.81.md>)
的 `egco` 也应改回「已对齐」。§15 自己的方法论是「以源码为事实源」，这两条却没按它执行。

### D11【P2】`hhe6` 引用了不存在的符号

[0157 第 627 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/adr/0157-reference-alignment-0.5.72-0.5.81.md>)
称由 `MessageFeedLayoutTopInset` 留白；全仓无此符号。真实实现是
[MessageFeedLayoutView.tsx 第 112 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/chat/MessageFeedLayoutView.tsx>)
的 `h-0 shrink-0 [[data-header-overlay=true]_&]:h-[80px]`，以及
[DefaultChatView.tsx 第 100–106 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/conversation/components/chat-view/DefaultChatView.tsx>)
的 `pt-11` / `-mt-11` 补偿。行为成立，引用需改正。

### D12【P2】批次编号 B8–B14 在 ADR-0157 内没有定义

ADR-0157 §2 的分批表只到 B7（[第 38–46 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/adr/0157-reference-alignment-0.5.72-0.5.81.md>)），
但状态列与 §15 大量引用「B8」「B10」「B14」，[ADR-0168 第 5 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/adr/0168-model-picker-single-source.md>)
还写「对应 ADR-0157 登记表 B10」——在 ADR-0157 里查不到 B10。补一张 B8–B14 的批次表，
或把状态列改成直接引用 ADR 编号。

---

## 4. 通过项（可确认成立）

- **ADR-0166 真实落地。** `reconcileSidebarForWidth`、`widthCollapsedSidebarRef`、
  `prevSidebarCollapsedRef` 全仓已无残留；`activityPanelMaxWidth` / `resolveActivityPanelWidth`
  已接收 `sidebarReserve`，上限为 `窗口 − 侧栏 − 384`
  （[activity-atoms.ts 第 53–54、92–100 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/shared/store/activity-atoms.ts>)）；
  `useActivityPanelModel` 在侧栏宽度变化时写占位
  （[第 199–202 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/activity-panel/hooks/useActivityPanelModel.ts>)）。
  实测 `activity-panel-width.test.ts` + `useActivityPanelModel.width.test.ts`：**13 passed**。
- 沉浸式顶栏三个状态（`44o7` / `hhe6` / `vld7`）行为成立：`pageHeaderImmersiveAtom` →
  `MainContentFrame.headerOverlay` → `data-header-overlay` → 80px 留白与遮罩渐变。
- `open-in-app` 的跨平台宿主能力真实存在：`external-apps.ts` 按 darwin/win32/linux 分派枚举，
  `ctx.shell` 与权限 `shell.open-external-app` 已接入；插件侧 197 行、逻辑清晰。
- 登记表中标「部分对齐」的条目（沙箱权限、@ 面板目录、插件设置页组件等）与代码一致，
  没有夸大。
- 更新器 12 条抽样成立（B7）：`stripReleaseNoteHeader` 由主进程与渲染共用
  （[updater-engine.ts 第 131、140 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/main/updater-engine.ts>)、
  [current-release-note.ts 第 24 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/main/current-release-note.ts>)）；
  对话框 600px 宽、`rounded-3xl`、正文 `no-scrollbar` 并内嵌 `ReleaseNoteMarkdown`
  （[UpdateRestartDialogView.tsx 第 88、104、124 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/overlays/UpdateRestartDialogView.tsx>)）；
  `b49e` 的 `busy = checking || downloading` 逐字对应
  （[UpdateCheckerView.tsx 第 57–59 行](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/overlays/UpdateCheckerView.tsx>)）。
  注意更新器界面在 `theme-ui/src/overlays/`，`renderer/domains/updater/` 目录不存在，
  按目录找不到不等于未实现。

---

## 5. 建议修复顺序

1. D2 → D3：先把红用例修绿（改测试即可，不动实现），恢复「验证」的可信度。
2. D1：模型菜单按 key 定位，删死 ref；补长列表用例。
3. D6 → D5 → D4：三个小改动，各自一条用例。
4. D7 → D8 → D10 → D11 → D12：只改文档，与上面同步一次提交。
5. D9：单独批次实施，状态先改「已接受，未实施」，版本推进与 SDK 合同一起做。

回归命令（每步执行）：

```text
bun run check:quick -- <改动文件...>
bun run test:impact -- <改动文件...>
```

---

## 6. 本次实际执行的验证

| 命令 | 结果 |
| --- | --- |
| `apps/desktop`: `run-vitest.mjs --run .../useManageSessionsModel.test.tsx` | 2 failed / 2 passed |
| `packages/theme-ui`: `run-vitest.mjs --run src/project/ManageSessionsSplashView.test.tsx` | 收集失败（缺 `@testing-library/react`） |
| `apps/desktop`: `run-vitest.mjs --run .../activity-panel-width.test.ts .../useActivityPanelModel.width.test.ts` | 13 passed |

未运行：Desktop 实机、`verify:ui:*`、完整 `bun run check`、三个外置插件的构建。
