# ADR-0160 ~ 0166「已对齐」批次审查报告

审查对象：ADR-0157 登记表中 0160 / 0161 / 0162 / 0163 / 0165 / 0166 六份记录声称完成的域。
基线：`HEAD = 367cb3ea0`（工作区未提交改动，约 227 个文件）。
审查方式：只读源码 + 定向用例，未启动 Desktop、未访问真实 Provider。

> **快照警告**：审查过程中工作区被并发修改（另一个 Agent 在推进 header-actions / 插件 SDK 等
> 不在本次范围内的批次）。可观测证据：
> `apps/desktop/src/shared/i18n/locales/{zh,en}/chat.json` 于 **21:48:46** 被整体改写，
> `activity-atoms.ts` / `useActivityPanelModel.ts` / `ChatView.tsx` / `useFilesPanelModel.tsx` /
> `ui-atoms.ts` 于 21:20 之后被改动。
> 本报告结论的时间戳为 **21:54**；标了「活文件」的条目（尤其 i18n 那组）需要在工作区收敛后再复核一次。

## 结论

**有阻断级发现：4 条。** 三类问题：

1. 三个包/域的测试套件当前是**红的**（新增用例不可运行 + 两条用例断言与实现相悖），
   「验证」一节写的"跑绿"不成立；
2. 一条 ADR 明写"已对齐"的模型菜单行为**根本没有接线**（`modelListRef` 从未挂到 DOM），
   属典型假对齐；
3. ADR-0165 把沉浸式顶栏写成"未做"，代码里已完整启用——状态列与现实相反，需要按代码回填，
   否则后续批次会基于错误结论继续做事。

---

## 阻断

### B1. `ManageSessionsSplashView.test.tsx` 无法运行，theme-ui 包测试变红

- 证据：[ManageSessionsSplashView.test.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/project/ManageSessionsSplashView.test.tsx>) 第 2 行 `import { render, screen, waitFor } from "@testing-library/react"`；
  `packages/theme-ui` 没有也刻意不引入 `@testing-library/*`（ADR-0157 第 7 节自己写明了这条约定，
  该包既有 jsdom 用例一律用 `react-dom/client` + `act`，如 [CompactionStepView.test.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/chat/CompactionStepView.test.tsx>) 第 2–5 行）。
- 可验证判断：在 `packages/theme-ui` 下执行 `node ../../scripts/quality/run-vitest.mjs --run src/project/ManageSessionsSplashView.test.tsx`
  → `Test Files 1 failed`，报错 `Failed to resolve import "@testing-library/react"`；该文件在收集阶段即失败，
  `bun run test:impact` / 包级 `test` 一旦选中它必红。
- 影响：ADR-0160「长列表窗口化 + 面板渲染」这条唯一的组件级验证实际上不存在。

### B2. `useManageSessionsModel.test.tsx` 两条用例真实失败（重跑稳定复现）

- 证据：[useManageSessionsModel.test.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/project/hooks/useManageSessionsModel.test.tsx>)
  - 第 134 行：`expect(result.current.selectedId).toBe(result.current.rows[0]?.id)` → 实际得到 `conversation:/b.jsonl`，
    期望 `conversation:/a.jsonl`。测试桩的 `deleteSession` 是 `vi.fn()`，会话列表不会缩短，而实现
    [useManageSessionsModel.ts](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/project/hooks/useManageSessionsModel.ts>)
    第 210 行按"删掉后落到相邻一行"正确地把选中项移到 `/b`。**实现是对的，用例没模拟"列表缩短"**。
  - 第 186 行：`expect(result.current.tabs).toHaveLength(3)` → 实际 `0`。第 44 行的 `buildPanel` 用普通项目，
    而实现第 91 行 `canTag = isDefault && !isClaw`，只有「对话」档才有标签页（这正是 ADR-0160 §2 的设计）。
    **用例与设计相悖**。
- 可验证判断：只跑这一个文件（正确 config）稳定 2 failed；同一批的另 3 条（时间、Ctrl+K/X、Esc）通过。
- 影响：ADR-0160 声称覆盖的「删除后选中落点」「标签页 / Tab 循环 / 行首色点」三条行为**没有任何有效验证**。

### B3. `useAbilitiesModel.test.tsx` 失败（横幅与列表标题重复命中）

- 证据：[useAbilitiesModel.test.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/abilities/hooks/useAbilitiesModel.test.tsx>) 第 332 行 `screen.getByText("Skill A")` → `Found multiple elements`：
  一处是横幅右侧的 featured 标题（20px），一处是卡片标题（13px）。
  行为变化来自本批：[useAbilitiesModel.ts](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/abilities/hooks/useAbilitiesModel.ts>) 第 184–196 行给 `bannerIcons` 补了 `title` / `description`。
- 可验证判断：B3 本身是**用例陈旧**（横幅显示标题是 ADR-0162 §2 的设计），但当前是红的，
  且这条用例正是「置顶/发现分区的平铺列表」唯一的结构回归保护。

### B4. 模型菜单「打开时把当前模型对齐到顶部」没有任何接线（假对齐）

- 证据：[ModelSelectorView.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/chat/ModelSelectorView.tsx>)
  第 171 行声明 `modelListRef`，第 200、218 行用它 `querySelectorAll`，但**全文没有任何 `ref={modelListRef}`**，
  也没有把它传给 `ModelSelectorMenuPanel`（该组件第 251 行有自己的内部 `listRef`）。
  `modelListRef.current` 恒为 `null`。
- 可验证判断：
  1. `grep -n "modelListRef" ModelSelectorView.tsx` 只有 171 / 200 / 218 三行，无挂载点；
  2. 即便接上，三栏中间栏是虚拟滚动（[ModelSelectorMenuPanel.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/chat/ModelSelectorMenuPanel.tsx>) 第 258–374 行只渲染窗口内行），
     目标行未挂载时 `scrollIntoView` 也无从生效——需要按行下标反算 `scrollTop`，代码里没有。
- 连带缺陷：第 218 行 `handleSearchKeyDown` 的 `items` 永远为空数组，但 `ArrowDown` 已被 `preventDefault`（第 222 行），
  用户按 ↓ 什么也不会发生、也不会滚列表——搜索框到列表的键盘通路是断的。
- 状态影响：ADR-0157 `257x`（"列表边缘渐隐，打开时当前模型对齐到顶部"）标为「已对齐（B3 续）」、
  ADR-0165 §2 重复声明，**均不成立**，必须改回待对齐或补实现。

---

## 重要

### I1. 安装进度一刷新，能力页横幅就重排并回到第一张

- 证据：[useAbilitiesModel.ts](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/abilities/hooks/useAbilitiesModel.ts>) 第 184–196 行
  `bannerIcons` 依赖 `allItems`；第 142 行 `allItems` 依赖 `actions.operationProgressById`，而
  [useAbilityActions.ts](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/abilities/hooks/useAbilityActions.ts>) 第 144–149 行每次进度回调都 `new Map(...)`。
  → 每次进度 tick 都产生新的 `allItems` → 新的 `bannerIcons` 数组引用 →
  [AbilitiesBanner.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/abilities/components/AbilitiesBanner.tsx>) 第 62 行 `useMemo([icons, isFallback])` 重新 `shuffleIcons`（`Math.random`），
  第 99–101 行 `setActive(0)`。
- 可验证判断：安装/下载任一能力期间，横幅图标顺序每秒变化数次且轮播总是从第 1 张开始。
  这与本批要达成的 `kprt`（不重算目录、不重渲染全部卡片）和 `eudr`（不可见时暂停）意图直接冲突——
  卡片保住了，横幅反而变成了新的每帧重排点。
- 建议修法（未实施）：`bannerIcons` 改为只依赖「稳定身份字段」的投影（如按 id+title+icon 拼签名 memo），
  或让 Banner 内部按 `icon.id` 序列做浅比较后再决定是否重排。

### I2. 矮窗口下管理会话的方向键会把选中行滚出视口，且再也滚不回来

- 证据：[ManageSessionsSplashView.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/project/ManageSessionsSplashView.tsx>) 第 123 行容器是
  `max-h-[min(420px,56vh)]`，第 231–236 行计算区间与第 245–257 行定位却都用常量
  `MANAGE_SESSIONS_LIST_HEIGHT = 420`（[manage-sessions-range.ts](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/project/manage-sessions-range.ts>) 第 46 行）。
- 可验证判断：窗口高 600px 时真实视口 ≈336px。第 30 行（rowTop=1080）按 420 算出的
  `scrollTop = 1080 - 420 + 36 = 696`，该行屏幕位置 `1080-696=384 > 336` → 不在视口内；
  随后区间（视口仍按 420）判定它"在窗口内"→ 函数返回 `null`，不再滚动。
  即：>80 条时连续按 ↓，选中项越过某个下标后就停在视口下方，按键继续移动但用户看不到。
- 建议修法：视口高度取容器的实测 `clientHeight`（`useLayoutEffect` + `ResizeObserver`），
  或把 `56vh` 的钳制同样写进常量算式（`Math.min(420, 0.56 * innerHeight)`）。

### I3. 三个新文案键在 zh / en 同时缺失，界面上是原始 key（活文件，需收敛后复核）

- 证据（当前快照，`chat.json` 已于 21:48 被改写）：
  - `fileEditor.locate` —— 引用处 [FilePreviewView.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/file-preview/components/FilePreviewView.tsx>) 第 44 行；
    现 `fileEditor` 只有 `showTree/hideTree/previous/next/...`，**无 `locate`**。
  - `fileExplorer.newMenu` —— 引用处 [useFilesPanelModel.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/file-explorer/hooks/useFilesPanelModel.tsx>) 第 749 行 `title={t("fileExplorer.newMenu")}`；键不存在。
  - `atPanel.referenceDirectory` —— 引用处 [useAtPanelModel.ts](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/conversation/hooks/useAtPanelModel.ts>) 第 375 行；
    `atPanel` 只有 `emptyDirectory/enterDirectory/goUp/header/loading/noResults/searchResults`。
- 可验证判断：`grep -rn "referenceDirectory\|newMenu\|\"locate\"" apps/desktop/src/shared/i18n/locales/*/chat.json` 无命中，
  三个组件却都在引用 → 北京/英文都会显示 key 原文。
  这三个键在本次审查早期（21:00 前后的 `git diff`）确实是新增状态，**被 21:48 那次 chat.json 改写丢了**。
- 这正是「中英缺一 / 漏文案」那一类问题，且是并发编辑造成的静默回退；收敛后请以 `git diff` 重新核对一次。

### I4. ADR-0165 把沉浸式顶栏写成"未做"，代码里已启用并已补偿

- 证据：
  - [ChatView.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/conversation/components/ChatView.tsx>) 第 154–158 行 `setHeaderImmersive(true)`（本批新增）；
  - [RootLayoutView.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/root-layout/RootLayoutView.tsx>) 第 150 行把 `pageImmersive` 并入 `headerOverlay`；
  - [MainContentFrame.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/layout/MainContentFrame.tsx>) 第 38 行落 `data-header-overlay="true"`；
  - [DefaultChatView.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/conversation/components/chat-view/DefaultChatView.tsx>) 第 100 / 106 行做 `pt-11` / `-mt-11` 补偿；
  - [MessageFeedView.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/chat/MessageFeedView.tsx>) 第 138–142 行把 `MessageFeedLayoutTopInset` 接成 Virtuoso `Header`。
- 可验证判断：会话页的页头确实是浮层，`hhe6`（"滚到顶第一条消息不被顶栏挡住"）已由
  `MessageFeedLayoutTopInset`（[MessageFeedLayoutView.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/chat/MessageFeedLayoutView.tsx>) 第 102–113 行，`[data-header-overlay=true]_&` 下 80px）覆盖。
- 影响：ADR-0165「后果」与 ADR-0157 的 `44o7`（部分对齐）/ `hhe6`（不适用）/ `vld7`（待对齐）
  三条状态**与代码相反**。这是"反向假对齐"：文档说没做，代码做了，状态列按文档写会误导下一批。
  按用户要求更新 0157 状态列时，这三条必须按代码现状改写，并注明沉浸式顶栏已落地。

### I5. 默认模型"清空"只清了配置，没清新会话读取的那份记忆

- 证据：[useModelsSettingsModel.ts](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/settings/components/useModelsSettingsModel.ts>) 第 403–417 行：
  设置默认模型时同步写 `localStorage["astravia-selected-model"]`，`next === undefined`（清空）时**不删**。
- 可验证判断：先把 A 设为默认（写入记忆），再清空默认 → 设置页显示"未设置"，但新会话仍按 localStorage 里的 A 发消息。
- 影响：两个事实源（`desktop-config.defaultModel` 与 `astravia-selected-model`）在"清空"语义上分叉；
  ADR-0161 §5 只写了"改默认模型时同步写"，没定义清空时的归属。

---

## 次要

| 位置 | 判断 |
| --- | --- |
| [styles.css](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/styles.css>) 第 144 行 vs [default.ts](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/shared/theme/themes/default.ts>) 第 70 行 | 浅色 `--muted` CSS 仍是 `242`，主题文件已改 `238`（mono / sand 的 TS 也改了、CSS 未同步）。首帧到主题应用之间有一次可见跳变；ADR-0163 §4 的"三主题同步加深"只在 TS 侧成立。 |
| [en/settings.json](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/shared/i18n/locales/en/settings.json>) 第 610 行 | `modelSettings.unsetDefault` 在英文里保留、中文已删、代码里 `grep unsetDefault` 零引用（死键），且缩进错位（4 空格 vs 2）。 |
| [CommandMenuRow.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/overlays/CommandMenuRow.tsx>) 第 100–102 行 | 标签色点占的是**行首图标位**，不是 ADR-0157 `aign` / ADR-0160 §2 描述的"行尾"。若对齐目标就是上游的行尾，则这条未达；若按本仓侧栏一致性取舍，需在 0157 状态列注明"行首"。 |
| [useTitlebarAnchor.ts](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/root-layout/useTitlebarAnchor.ts>) 第 33–35 行 | 只 observe `document.body` + `layoutKey`。ADR-0163 §5 说"布局任何变化都会重新量"，但页头内部高度变化（标题换行、页头右侧槽位增删）不会改变 body 尺寸，也不会改 `layoutKey` → 不重测中线。 |
| [ModelSelectorMenuPanel.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/chat/ModelSelectorMenuPanel.tsx>) 第 336 行 | `mask-image` 常开（上下各 10px）。不足一屏时首行顶部照样被淡化；上游按滚动位置动态开关上下渐隐。 |
| [project-clone.ts](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/main/ipc/project-clone.ts>) 第 79–80 行 | `existsSync(target)` 之后再 `spawn git` 是 TOCTOU；同名目录在两次克隆间被创建时 git 自己会失败，用户看到的错误文本会退化到 git 的原始输出（`tailMessage` 兜底）。影响很小。 |
| [manage-sessions-range.ts](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/project/manage-sessions-range.ts>) 第 17–41 行 / [model-selector-columns.ts](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/packages/theme-ui/src/chat/model-selector-columns.ts>) 第 140–164 行 | 两份几乎相同的区间算法（注释写"同一套算法、不同阈值"），改一处忘另一处就会分叉；建议合并为一个带 `threshold/overscan` 参数的公共函数（`theme-ui` 内部）。 |
| `SidebarUpdateButton`（[新文件](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/project/components/sidebar/update/SidebarUpdateButton.tsx>)） | 替换旧 `useSidebarUpdateBannerModel` 时连同其测试一起删除，新模型没有对应测试（可用 `available/downloading/ready/idle` 四态覆盖，属纯函数级）。 |

---

## 存疑（需要产品或实现方确认，暂不判缺陷）

1. **`syncHostPassword` 用 IPC 原值判定**（[ipc/ssh.ts](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/main/ipc/ssh.ts>) 第 50–65 行）：是否清口令看 `raw.authMethod`，不看归一化后的 host。
   当前唯一调用方总会带上该字段，但将来若出现"只改端口"的部分更新，会静默清掉已存口令。建议改为由 `normalizeSshHostInput` 的结果驱动。
2. **口令是否可能落到日志**：`ssh.ts` 链路本身不记日志，`CredentialVault` 也是加密存储——
   本次未发现明文落盘路径（ADR-0157 `9vsq` 的"不落明文"在 `desktop-config` / `SshHost` 两层都成立）。存疑点仅在 IPC 层没有对 `password` 字段做长度/类型上限校验。
3. **`AutomationPromptField` 的技能回写**（[AutomationPromptField.tsx](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/scheduler/components/AutomationPromptField.tsx>) 第 72 行）：`onChange(body, [...skills])` 用的是本次渲染的 `skills`，
   若 `SkillPromptArea` 在同一帧里既改正文又改技能，第二项会被第一次回调的旧技能覆盖。取决于该区域是否受控，需实测。
4. **确认框打开时 Esc 会同时关掉管理会话面板**：`useManageSessionsModel` 用 window 捕获态监听整个 open 期间（第 457–467 行），
   而删除"同一会话"自动化绑定的会话会弹出 `confirmDialogAtom`。两个 Esc 处理器同时在场，行为未定义（`SplashPanel` 自己不管 Esc）。
5. **`@` 面板引用的目录没有 `relPath`**（[useAtPanelModel.ts](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/apps/desktop/src/renderer/domains/conversation/hooks/useAtPanelModel.ts>) 第 250–255 行只传 `path/name/isDirectory`），
   mention token 的展示文案依赖 path 兜底；本地可用，SSH 项目仍只有文件（ADR-0165 已声明限制）。

---

## 逐域核对结论

| ADR | 域 | 结论 |
| --- | --- | --- |
| 0160 | B4 管理会话 / 添加项目 / 项目页 | 实现基本到位（Splash 原语自 portal、`AddProjectSplash` 分步、`project-clone` 的 URL 白名单与取消清理、项目页会话列表底色与胶囊切换都在）；**验证不成立**（B1、B2），窗口化在矮窗口有可见缺陷（I2）。 |
| 0161 | B5 设置与外观 / SSH | 六档吸附、菜单走 `stepUiZoom`、`UiZoomControl` 拖拽只预览、SSH 字段拆分与口令进 `CredentialVault`、`buildSshArgv` 只尝试口令认证——均实测与 ADR 一致，`ui-zoom` / `useSshHostsSettingsModel` / `AppearanceSettingsView` / `ModelsDefaultModelSection` / `UiZoomControl` 用例全绿。遗留：默认模型清空语义（I5）、`styles.css` 与主题文件不同步。 |
| 0162 | B6 能力页 / 自动化 / 文件树 / 预览 | 布局、横幅暂停策略、`AutomationPromptField`、文件树新建下拉、预览定位都在且用例通过；**横幅在安装进度下重排（I1）**、`useAbilitiesModel.test.tsx` 红（B3）、`newMenu` / `locate` 文案缺失（I3）。 |
| 0163 | B7 共享皮肤 / 主题 / 红绿灯 | 常量收口、`.overlay-backdrop` 标记类与侧栏实色规则、Dialog/确认框去线留白、三主题令牌（与上游 0.5.81 逐值一致）、`trafficLightPositionFor` 与 `data-titlebar-anchor` 实测链路都在；`activityPanelFrame` 只留左上角与左/上边框、`ActiveTabIndicator` 不再换元素类型——均已核对。问题只在 `styles.css` 未同步（次要）与中线重测范围（次要）。 |
| 0165 | 会话域剩余 | 三栏、收藏、详情浮层、玻璃材质、CSS 开合、`footerStart/End` 插槽、宿主注册的 `mod+p`、@ 目录引用都在；**"打开对齐到顶部"完全没接线（B4）**；沉浸式顶栏状态写反（I4）。 |
| 0166 | 侧栏常驻与活动面板宽度 | `reconcileSidebarForWidth` / `widthCollapsedSidebarRef` / `prevSidebarCollapsedRef` 已彻底删除（`grep` 零命中）；`activityPanelMaxWidth(windowWidth, sidebarReserve)` + `resolveSidebarReserve` 与 `sidebar-state` 的 `visible` 判据同源；`activity-panel-width.test.ts` 9 条、`useActivityPanelModel.width.test.ts` 3 条全绿。**未发现缺陷。** |

## 已执行的验证

| 命令 | 结果 |
| --- | --- |
| `node scripts/quality/run-vitest.mjs --run --config apps/desktop/vitest.config.ts <13 个定向文件>` | 63 passed / 5 failed；其中 3 条为机器负载导致的 5s 超时，单独重跑全部通过 |
| `node scripts/quality/run-vitest.mjs --run --config apps/desktop/vitest.config.ts model-selector-menu-panel / AbilitiesPageView.layout / useManageSessionsModel` | 19 passed / **2 failed**（B2 两条稳定复现） |
| `node scripts/quality/run-vitest.mjs --run --config apps/desktop/vitest.config.ts useAbilitiesModel.test.tsx` | 5 passed / **1 failed**（B3） |
| `cd packages/theme-ui && node ../../scripts/quality/run-vitest.mjs --run src/project/ManageSessionsSplashView.test.tsx` | **收集失败**：`Failed to resolve import "@testing-library/react"`（B1） |
| `cd packages/theme-ui && … src/project/manage-sessions-range.test.ts src/chat/model-selector-columns.test.ts` | 19 passed |
| `cd packages/ui && … src/step-slider.test.tsx` | 5 passed（该用例用 happy-dom + react-dom，不依赖 testing-library，符合 ADR-0157 §7） |
| `apps/desktop/src/shared/ui-zoom.test.ts`、`activity-panel-width.test.ts`、`useActivityPanelModel.width.test.ts` | 全绿（6 + 9 + 3） |
| 上游对照（`../open-vetta`，v0.5.81） | 主题 `default.ts` / `mono.ts` 逐值一致；`ModelSelectorView` 上游确有 `scrollRef` 挂载（`packages/theme-ui/src/chat/ModelSelectorView.tsx:579,582`），本仓重写三栏时丢失 |

**未执行**：任何 `verify:ui:*`、Desktop 启动、真实 SSH / Provider 连接、全量 `bun run check`。
原因：审查约定只读，且这些流程需要用户授权或占用运行中的实例。

## 建议的修复顺序

1. B1 → 把 `ManageSessionsSplashView.test.tsx` 迁到 `apps/desktop`（那里有 testing-library），或改用 `react-dom/client` + `act` 保持包内约定；
2. B2 / B3 → 修正三处用例（删除后缩短列表、标签页改用「对话」档项目、横幅标题用 `getAllByText` 或限定容器）；
   修正前不要在任何交付里写"用例全绿"；
3. B4 → 给 `ModelSelectorMenuPanel` 加 `ref`/`scrollRef` 并用行下标反算 `scrollTop`（虚拟列表下 `scrollIntoView` 不成立）；
   同时恢复搜索框 ↓ 到列表的键盘通路。ADR-0157 `257x` 在实现前应回退为「待对齐」；
4. I1 → 切断 `bannerIcons` 对操作进度 Map 的依赖；
5. I2 → 用实测视口高度替换常量；
6. I3 → 收敛并发改动后补回三个文案键，并在 `bun run check` 前用中英 diff 复核；
7. I4 → 按代码现状改写 ADR-0157 的 `44o7` / `hhe6` / `vld7` 与 ADR-0165 的「后果」；
8. I5 → 定义"清空默认模型"是否同时清 `astravia-selected-model`，二选一并写进 ADR-0161。
