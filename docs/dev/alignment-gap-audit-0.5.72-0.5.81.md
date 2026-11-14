# 0.5.72–0.5.81 对齐缺口审计（ADR-0157 未完成条目）

> **本文是后续实施的唯一依据。** 只覆盖 ADR-0157 登记表里仍标着 `待对齐` / `部分对齐` /
> `需产品决策` / `等价实现` 的条目；已确认对齐的条目不在此重复。每条都给出上游提交、
> 本仓当前符号位置、差距与可直接执行的改法。实施完一条就把该条改写回
> [ADR-0157](../adr/0157-reference-alignment-0.5.72-0.5.81.md) 的状态列，
> 与代码同一个提交，不要攒到最后。

## 0. 取源与判定口径

| 项 | 值 |
| --- | --- |
| 上游参照仓库 | `/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta` |
| 上游基线 | `v0.5.81` = `488724ad8`（`chore(release): 合并 dev 发布 v0.5.81`），区间 `v0.5.72..v0.5.81` 共 259 个提交 |
| 本仓快照 | `main` @ `367cb3ea0` + 工作区未提交改动（审计时 330 项，包含 B6–B13 的落地） |
| 判定依据 | 只认源码、类型定义、i18n 资源、测试与文档的实际内容；不按提交标题、不按 ADR 状态列 |
| 采集时间 | 2026-11-14 |

判定词汇：

| 词 | 含义 |
| --- | --- |
| **缺口** | 本仓确实没有该可观察行为，需要写代码 |
| **文档过期** | 行为已经对齐，只是登记表/证据文档写错，改文档即可 |
| **保留差异** | 行为与上游不同，但有本仓事实支撑，不应"补齐"；登记表要写明理由 |
| **待决议** | 阻塞在品牌素材或产品身份选择，不是技术问题 |

**快照提醒**：本仓工作区在审计期间仍有并行改动（ADR-0157 与若干 renderer 文件在审计过程中
被改写）。下文所有 `file:line` 都是采集时刻的位置；实施前请按符号名重新定位，不要按行号盲改。

## 1. 结论总表

登记表里未完成的行共 32 条，另有一条（`ro8e`）被误记为已对齐、实为缺口，合计 33 条需要动作。逐条复核后归为四类：

| 分类 | 条数 | 条目 |
| --- | --- | --- |
| 文档过期（改文档即可） | 6 | `2ux7` `imur` `egco` `llr7` `9d56` `hl6i` |
| 保留差异（登记表写明理由） | 2 | `gtd6`、`jhbp`（等价实现） |
| 真实缺口（要写代码） | 12 | `dkqa` `tu3l` `ho2s` `dqpd` `6d2h` `4b7x` `129g` `pan7` `r81i` `v01k` `qzkn` `10e8` |
| 待决议（品牌/产品） | 11 | 像素图标组 5 条（`fdho` `btmv` `d1vl` `dl89` `dtza`）+ Magpie 组 5 条（`5ckc` `renp` `bnje` `lajl` + `0ri8`）+ 可用自有素材先做的 1 条（`e7nz`） |

校验：文档过期 6 + 保留差异 2 + 真实缺口 12 + 待决议 11 + `izqa`（已排进 P9）= 32；
再加误记为已对齐的 `ro8e`（P4），本次共 33 条需要动作。

### 1.1 必须先纠正的三处文档矛盾

审计发现登记表、证据文档与源码三方互相矛盾。这些不改，后面的人会按错误前提动手：

| 位置 | 现写法 | 事实 |
| --- | --- | --- |
| ADR-0157 §15 表 | `2ux7` → "部分对齐：`useActiveConversation` 仍订阅整份会话" | `plugin-host-bridge.ts:793-804` 已改为分别订阅 `activeSessionRuntimeIdAtom` / `activeSessionCwdAtom` / `activeSessionPathAtom` + `isStreaming` / `selectedModel`，并用 `useMemo` 组装。**已对齐** |
| `docs/dev/alignment-evidence-b8-b13.md` §1 与 §2.1 | `egco` → "`plugin-ui` 未开放四个设置组件；插件文档无组件速查" | `packages/theme-ui/src/plugin-ui/index.ts` 已导出 `MotionSelect` / `SettingSection` / `SettingRow` / `SettingHeading`；`docs/plugin/styling-and-pitfalls.md` 已有「可用组件速查」与「设置页同款组件的用法」两节。**已对齐** |
| 同上 §1 / §2.1 | `2ux7` → "未订阅派生字段；`chat-atoms` 无派生 atom" | 同上，已实现 |

另外 ADR-0157 §14 写「需产品决策的 11 条（4 + 4 + 3）」，登记表实际有 13 条
（Magpie 5、应用图标与 Dock 7、Splash 1），且其中 1 条已随上游最终一致。数字要一并改。

## 2. 逐条明细：文档过期（6 条）

### 2.1 `2ux7` 顶栏探针去重 / `useActiveConversation` / 关背景模糊

- **上游**：`2e2d5df56`
- **本仓**：探针按签名去重（`domains/header-actions/ConversationHeaderActions.tsx`）、
  `ButtonGroup blur={false}`、`useActiveConversation` 五字段订阅均已在位。
- **结论**：已对齐。只改登记表状态。
- **验证**：`plugins/runtime/plugin-header-action.test.tsx:279` 已有订阅范围断言。

### 2.2 `imur` Splash 去边框改柔和外投影、蒙层调淡

- **上游**：`4a28968df`（去边框、两层投影、蒙层 `blur 14px→10px`、底 `0.32/0.28→0.2/0.18`），
  其后 `8c7d46a2f` 又去掉 Splash 外阴影，但最终 `v0.5.81` 的 `SplashPanel` 统一改用
  `PANEL_SHADOW_CLASS`（`packages/theme-ui/src/overlays/SplashPanel.tsx:71`），阴影回来。
- **本仓**：`packages/theme-ui/src/overlays/SplashPanel.tsx` 用 `OVERLAY_BACKDROP_CLASS` +
  `rounded-2xl bg-popover` + `PANEL_SHADOW_CLASS`，与上游最终态逐字一致；
  `PANEL_SHADOW_CLASS` 取值与上游 `packages/ui/src/utils.ts:24` 相同；
  蒙层 `styles.css` 的 `.overlay-backdrop` 是 `blur(10px)` + `rgb(255 255 255/0.2)` / `rgb(0 0 0/0.18)`。
- **结论**：已对齐（中间态被上游后续提交覆盖，按最终态判定）。

### 2.3 `egco` 插件可用按钮组 / 设置页下拉 / 设置项卡片 / 文档

- **上游**：`a50993e86`
- **本仓**：`@astravia-org/ui` 已导出 `ButtonGroup` / `ButtonGroupItem`（`packages/ui/src/index.ts:3-9`），
  `Button` 有 `variant: "field"`（`packages/ui/src/button.tsx:16`）；
  `theme-ui/plugin-ui` 已导出四个设置组件；插件文档已有速查表。
- **缺口（很小）**：上游同时补了宿主 shim 可达性断言
  （`plugin-host-shim.test.ts` 里逐个 `expect(...).toBeDefined()`）。
  本仓 `plugin-shared-modules.test.ts` 覆盖了清单，但没有"插件实际能拿到这些名字"的断言。
- **改法**：在 `apps/desktop/src/renderer/domains/plugins/runtime/plugin-host-shim.test.ts` 增一例，
  断言 `__ASTRAVIA_PLUGIN_HOST__.astraviaUi.ButtonGroup` / `themeUiPlugin.SettingRow` 等可达。
- **验证**：`bun run test:impact -- apps/desktop/src/renderer/domains/plugins/runtime/plugin-host-shim.test.ts`

### 2.4 `llr7` 桌面端与 Agent 能力接入 sse 传输、`9d56` 运行时支持旧式 HTTP+SSE

- **上游**：`7c58c7313`（桌面数据模型 / 表单 / 预设 / OAuth / `mcp.manage` / capability-sdk / plugin-sdk）、
  `db2024a88`（`runtime-mcp` schema、`HttpMcpClient` 按 type 选传输、`sse` 仅 legacy）
- **本仓**：全部在位——
  - `packages/runtime-mcp/src/config/schemas.ts:37,73`：`"http" | "sse"`，`sse` 只允许 `protocolMode: "legacy"`
  - `packages/runtime-node/src/mcp/transports/http/http-mcp-client.ts:93` 起按 type 分派
  - `apps/desktop/src/main/mcp-config-validation.ts:98` 有独立 `sse` 分支
  - 设置页 `McpServerForm.tsx:74` 有 SSE 传输选项；审批卡 `McpUpsertApproval.tsx:19,86`
  - `capability-sdk/src/domain/mcp.ts:14`、`plugin-sdk/src/official.ts:157,192`、
    `presets/astravia-actions/src/domains/mcp.ts:63` 均接受 `sse`
  - OAuth 按传输建会话：`runtime-node/src/mcp/auth/browser-oauth-sdk-session.ts`
- **剩余测试缺口**：上游 `db2024a88` 新增了 `runtime-node/test/mcp/sse-mcp-client.test.ts`
  （用 SDK 的 `SSEServerTransport` 起真服务器验证连接、调用、鉴权）。本仓
  `packages/runtime-node/test/mcp/` 下没有 SSE 用例，只靠 `http-mcp-client.test.ts` 覆盖 http 分支。
- **改法**：补一个同层用例，用 `SSEServerTransport` 起临时服务器，断言
  ① 能连上并 `listTools`；② `type:"sse"` + `protocolMode:"modern"` 在解析期被拒；
  ③ 401 时走 OAuth 授权会话。
- **验证**：`bun run test:impact -- packages/runtime-node/test/mcp/sse-mcp-client.test.ts`

### 2.5 `hl6i` 去掉 Splash 面板的外阴影

- **上游**：`8c7d46a2f`，随后被 `v0.5.79` 的共享面板皮肤（`PANEL_SHADOW_CLASS`）覆盖。
- **本仓**：与上游最终态一致（见 §2.2）。
- **结论**：已对齐，从"需产品决策"移出。它本来也不是品牌问题。

## 3. 逐条明细：真实缺口

### 3.1 chat `dkqa` 沙箱权限进模型菜单底栏 + `Cmd/Ctrl+P`（部分对齐）

**上游**：`cf3dbadf3`

**上游最终形态**（`ModelSelector.tsx`）：快捷键是**可配置的全局动作** `open-model-selector`
（`shared/shortcuts.ts` 白名单，默认 `mod+p`），根布局广播 `OPEN_MODEL_SELECTOR_EVENT`，
输入栏里的选择器监听事件开关；底栏左侧渲染 `<kbd>` 分段提示，用 `useShortcutBinding` 读
当前生效组合键，改键后提示实时变化；右侧 `footerEnd` 放沙箱权限并 `showLabel`。

**本仓现状**：

| 项 | 状态 | 证据 |
| --- | --- | --- |
| 沙箱权限进底栏 | ✔ | `input-bar/DefaultInputBarConnector.tsx:242` 用 `ModelMenuFooterContext.Provider` 提供 `<ExecutionModeSelector>`；`InputBarToolbarActions.tsx` 在 `menuFooter` 存在时不再渲染工具栏控件 |
| `Cmd/Ctrl+P` 能开菜单 | ✔（写死） | `ModelSelector.tsx:28-46` 在 `useShortcutScope` 里硬编码 `key: "mod+p"` |
| 快捷键可配置 | ✘ | `apps/desktop/src/shared/shortcuts.ts` 的 `SHORTCUT_ACTIONS` 没有 `open-model-selector`，设置页里改不了 |
| 底栏左侧快捷键提示 | ✘ | `ModelSelector.tsx:61` 只传 `footerStart={footer}`（就是权限控件），没有 `<kbd>` 提示 |

**改法**（沿用本仓既有机制，不引入事件总线）：

1. `apps/desktop/src/shared/shortcuts.ts`：`SHORTCUT_ACTIONS` 增
   `{ id: "open-model-selector", defaultShortcut: "mod+p", scope: "app" }`，
   并补 `labelKey` / `descriptionKey`（设置页由 `useShortcutsSettingsModel.ts:131` 遍历白名单生成，加了就有行）。
2. i18n：`zh/settings.json` / `en/settings.json` 补 `shortcutOpenModelSelectorLabel` /
   `shortcutOpenModelSelectorDesc`（对照现有 `shortcutOpenCommandMenu*` 的写法与位置）；
   `zh|en/chat.json` 补提示用的 `modelSelect.shortcutHint`（悬停说明）。
3. `ModelSelector.tsx`：把写死的 `key` 换成 `useEffectiveShortcut("open-model-selector")`
   （`shared/hooks/useShortcuts.ts:87` 已有）；`bindings` 的依赖数组带上它。
4. 底栏：`footerStart` 改成一个小片段，左 `<kbd>` 提示 + 右权限控件——
   `shortcutParts()` 已在 `shared/lib/platform.ts:87`，直接复用即可拼 `⌘` `P` 分段。
   注意 `footerStart` 现在承担"优先级控件"语义，改成节点后
   `if (model.empty) return <>{footer}</>` 这条兜底要保留（无模型时不能把权限选择器一起吃掉）。
5. 与 ADR-0168 的关系：`ModelSelector` 的 `footerStart` / `footerEnd` 两个插槽要保持，
   收敛后的 `ModelSelectorView` 必须同时支持，否则 §3.10 会把它打回去。

**验证**：

- 新增 `ModelSelector.shortcut.test.tsx`（仿 `ModelSelector` 现有 jsdom 用法）：默认 `mod+p` 能开合；
  把用户绑定改成 `mod+shift+p` 后旧键无效、新键生效；`model.empty` 时快捷键不抢键且权限控件仍在。
- `useShortcutsSettingsModel` 的用例里加一条断言：白名单含 `open-model-selector` 且渲染出一行。

### 3.2 chat `tu3l` 模型菜单稳定引用 + 行 memo + 倍率 Map（部分对齐）

**上游**：`7044d2fa4`

**上游做了什么**（三件事，缺一不可）：

1. `useModelSelectorModel`：`multiplierByKey = useMemo(new Map(options.map(o => [o.key, o.multiplier])))`，
   `multiplierLabelFor` 改查 Map（原来是每行 `options.find`，O(n²)）。
2. `groups` / `labels` 各自 `useMemo`，引用不随无关 atom 变化而换新。
3. 视图抽出 `ModelRow` 并 `memo`，`onModelSelect` 经 ref 取最新值（宿主回调每次换引用会打穿 memo）。

**本仓现状**：

- `hooks/useModelSelectorModel.ts:158-168`：`multiplierLabelFor` 里仍是 `options.find(...)`。
- 同文件 `:189` 起 `groups: [...grouped.entries()].map(...)`、`labels: {...}` 直接写在返回对象字面量里，
  每次渲染都是新数组/新对象。
- `packages/theme-ui/src/chat/ModelSelectorMenuPanel.tsx:131` 的 `ModelRow` 没 `memo`；
  `:370-371` 传的是 `onSelect={() => onSelectModel(...)}`、`onToggleFavorite={() => ...}` 内联闭包。

**为什么这一条重要**：这是用户第 9 项"卡顿"里点名的一半（"悬停和上下选择卡顿"）。
先做 1+2+3，才谈得上"上百个模型时搜索逐字输入不卡"。

**改法**：

1. `useModelSelectorModel.ts`：加 `multiplierByKey`，`multiplierLabelFor` 依赖改 `[multiplierByKey, t]`。
2. 同文件：`groups`、`labels` 提到 `viewProps` 之前做 `useMemo`，依赖收窄到
   `[grouped, iconFor, labelFor]` / `[t, multiplierLabelFor, levelLabel, favoriteLabels...]`。
   注意本仓 `labels` 比上游多 `favoritesHeader` / `favorite` / `unfavorite` / `searchResultsHeader`，
   依赖数组按实际字段写全。
3. `ModelSelectorMenuPanel.tsx`：
   - `ModelRow` 包 `memo`；
   - 回调形态改成"传 key"：`onSelect: (key: string) => void`、`onToggleFavorite: (key: string) => void`，
     行内 `onClick={() => onSelect(model.key)}`，父层只传稳定引用；
   - `labels` 在本仓是**纯数据**（全部是字符串 + `multiplierLabel` / `levelLabel` 两个函数，
     `infoButton` 也是文案键而非节点），所以只要 `labels` 整体 `useMemo` 稳定，
     `ModelRow` 直接比 `labels` 引用就够了。不要按上游写成比对象内容——比内容等于放弃 memo 的意义。
   - 若后续有人把节点塞进 `labels`，memo 会静默失效；在 `labels` 的类型注释里写一句
     "只放文案与稳定函数，不要放 ReactNode"作为约束。
4. 虚拟滚动已存在（>60 行窗口化），不要动阈值。

**验证**（要能真失败，不要只跑通）：

- `shared/components/model-selector-menu-panel.test.tsx` 增：
  ① 输入搜索串前后 `onSelect` / `labels` 的**引用身份不变**（对象同一性断言，稳定可测）；
  ② 100 个模型 + 逐字输入时，`ModelRow` 的 render 次数 ≤ 可见行数 × 2（用 `vi.fn` 包一层行渲染计数）。
- 行为回归：倍率文案（免费 / `×N`）与"默认"徽章在有/无 `infoButton` 两种宿主下都不变。

### 3.3 chat `ho2s` @ 面板引用目录（部分对齐：本地已做，SSH 未做）

**上游**：`ef28286b5`。链路是四段，本仓只差后三段。

| 段 | 上游做法 | 本仓 |
| --- | --- | --- |
| 渲染层与交互 | `AtPanelView` 目录行给"引用目录"入口、搜索结果里目录也回吐路径 | ✔ `packages/theme-ui/src/chat/AtPanelView.tsx`（`onReferenceDirectory`、`isDirectory`）；`useAtPanelModel.ts:249-262` 搜索态点目录即引用 |
| IPC `fs:list-files-recursive` 接受 `options.includeDirectories` | 校验后传下去 | ✔ `apps/desktop/src/main/ipc/fs.ts:299-306` |
| 本地枚举目录 | `listFilesystemFilesRecursive(root, { includeDirectories })`，目录与文件各一份上限 | ✔ `main/filesystem/filesystem-service.ts:503-545`，有 `filesystem-service.test.ts:123` |
| **SSH 远端枚举目录** | helper `fs.listRecursive` 增 `IncludeDirectories`；`ssh-transport` 增 `includeDirectories` + `parseListFilesRecursiveOutput`；`remote-filesystem` 把尾随 `/` 还原成 `isDirectory` | ✘ 三段都缺 |

**SSH 侧的具体差距**（可逐项对着改）：

1. `apps/ssh-helper/internal/server/fs.go:341` `listRecursiveParams` 无 `IncludeDirectories`；
   `fsListRecursive` 只 walk 文件。上游做法：目录单独一轮 walk、**单独一份 `limit`**
   （目录不占文件名额），返回值以 `D\t` / `F\t` 前缀区分，或目录路径带尾随 `/`。
   本仓选后者更省改动：与 `listRemoteFilesRecursive` 现有的 `relPath` 语义兼容。
2. `packages/ssh-transport/src/remote-command.ts` 的 `ListFilesRecursiveOptions` 无该字段；
   `buildListFilesRecursiveCommand` 只跑 `-type f`；`ssh-connection.ts:335` 的
   `listFilesRecursive` 也不透传。
3. `apps/desktop/src/main/filesystem/remote-filesystem.ts:240` 的
   `listRemoteFilesRecursive` 参数类型无 `includeDirectories`，映射时也不判目录。
4. 丢参位置已定位：调用侧 `useAtPanelModel.ts:179` 已无条件传 `{ includeDirectories: true }`，
   `ipc/fs.ts:296-308` 也正确解析；但 `main/filesystem/filesystem-service.ts:513-518` 在
   `isSshProjectUri(rootPath)` 分支里只传了 `ignoredDirectoryNames` / `limit` / `names`，
   **`includeDirectories` 被静默丢弃**。这就是本地能用、SSH 不行的准确原因。

**改法顺序**：helper（含 Go 单测）→ ssh-transport（含 `remote-command.test.ts`）→
remote-filesystem → 主进程 `fs.ts` 远端分支透传 → `useAtPanelModel` 不用改。

**验证**：

- `(cd apps/ssh-helper && go test ./internal/server/...)`：新增"目录与文件各一份上限""忽略目录不出现"两例。
- `packages/ssh-transport/src/remote-command.test.ts`：命令串含目录段的 `find -type d`，
  且解析函数把 `dir/` 还原成目录标记。
- 手测路径（写进 PR 说明即可，不必 E2E）：SSH 项目里 `@` 搜一个目录名 → 回车引用 → 输入框出现目录路径。

### 3.4 mcp `ro8e` 项目层并入根目录 `.mcp.json`（登记表写"已对齐"，实际未接线）

**上游**：`1b2487f3a`，两处改动：runtime 库支持 `compatProjectConfigPath`，
**并且**桌面端 supervisor 把 `.mcp.json` 传进去 + 复用 `writeDiagnostic`。

**本仓现状**：

- 库层已实现：`packages/runtime-node/src/mcp/config/file-config-source.ts:14` 有
  `compatProjectConfigPath`，`loadProject()` 里 `{...compat, ...native}` 同名整体替换，
  `${VAR:-default}` 展开在 `:178`。
- **桌面端没接**：`apps/desktop/src/main/agent-runtime/mcp-supervisor.ts:83` 构造
  `new FileMcpConfigSource({ globalConfigPath, projectConfigPath, projectRoot, ... })`，
  既没有 `compatProjectConfigPath: join(options.projectRoot, ".mcp.json")`，
  也没有把 `writeDiagnostic` 作为 `onDiagnostic` 传进去。
  因此用户仓库里的 `.mcp.json` 在桌面端**完全不会被读到**，而库层单测是绿的——
  这正是"库对齐 ≠ 产品对齐"的典型漏点。

**改法**：在 `mcp-supervisor.ts:83` 的构造里补两个字段（与上游逐字一致）：

```ts
compatProjectConfigPath: join(options.projectRoot, ".mcp.json"),
onDiagnostic: writeDiagnostic,
```

**验证**：在 `apps/desktop` 侧补一例 supervisor 级用例（若现有 MCP supervisor 测试基建可复用），
断言：根目录放 `.mcp.json` → `list()` 能看到；同名 server 以 `.mcp/config.json` 为准；
坏条目只出一条诊断不炸整体。只有库层测试不算完成。

### 3.5 mcp `dqpd` `mcp.manage` 支持全局 / 项目层（待对齐）

**上游**：`46f2f3dbb`（+ ADR-0153）。这是 MCP 批里唯一需要动公共合同的一条。

**上游改了什么**：

- 能力与 SDK：`mcp.manage` 输入增可选 `scope: "global" | "project"` 与 `cwd`，缺省 `global`；
  `scope=project` 必须带本机项目根绝对路径，远程项目直接拒。
- 服务层：`McpSettingsService` 的 upsert/remove/setEnabled 接受 `{ scope, cwd }`；
  按名字定位时若全局与项目同名，**必须指明 scope**；`.mcp.json` 里的条目只读。
- IPC / preload / capability-sdk / plugin-sdk / `astravia-actions` 全链路透传。
- 审批弹窗：显示"配置位置"（全局 / 项目根），确认后原样带回 scope，
  避免用户以为装到项目、实际写进全局。

**本仓现状**：一处都没有。

- `apps/desktop/src/main/mcp/mcp-settings-service.ts` 只有 `readMcpConfig` / `writeMcpConfig`
  全局文件；`upsert(name, data, { abilityVersion })` 无 scope；`McpSettingsServiceOptions` 无 `cwd`。
- `packages/plugins/presets/astravia-actions/src/domains/mcp.ts:35-98` 的 `manageSchema`
  三个分支都 `additionalProperties: false`，`scope` / `cwd` 传进来会被 schema 直接拒。
- 审批卡 `shared/action-approval/manage/mcp/McpUpsertApproval.tsx` 没有位置展示。

**改法（建议按此顺序，每步可独立绿）**：

1. **服务层先行**：`McpSettingsService` 增 `scope`/`cwd` 解析。
   项目层读写 `<cwd>/<CONFIG_DIR_NAME>/mcp.json`（复用本仓既有常量，不要硬编码目录名，
   也不要借用其他工具的 `.claude` 之类目录）；`assertProjectRoot(cwd)` 拒绝 `ssh://` 与相对路径；
   同名冲突时抛明确错误（错误文案要能直接展示给用户）。
2. **IPC + preload**：`ipc/plugin-capabilities.ts` 的 mcp 通道透传 scope/cwd，
   `preload/api-types/plugins.ts` 的类型同步。
3. **合同层**：`capability-sdk/src/domain/mcp.ts`、`plugin-sdk/src/official.ts`、
   `astravia-actions` 的 `manageSchema` 增可选字段，并在 `description` 里写清
   "项目层会进仓库、密钥只允许 `${VAR}` 引用"。
4. **审批 UI**：`McpUpsertApproval` 显示目标层与绝对路径；`mcp-approval-target` 这类
   纯逻辑抽成可测函数（上游就在这个位置加了 `mcp-approval-target.ts` + 单测）。
5. **文档**：`docs/capabilities/catalog.json` 重新生成；能力说明与技能文档同步（见 §3.6）。

**验证**：

- 服务层单测：全局 upsert / 项目 upsert / 同名冲突报错 / `cwd` 为远程 URI 被拒 /
  `.mcp.json` 只读条目不可改。
- 合同测试：`manageSchema` 接受 `{operation:"upsert", name, scope:"project", cwd:"/abs"}`，
  拒绝 `scope:"project"` 无 `cwd`。
- 审批卡组件测试：项目层时显示路径，确认后 handler 收到的 scope 与展示一致。

### 3.6 skill `6d2h` / `4b7x`（待对齐，其中一条阻塞于 3.5）

**上游**：`4a5fec47e`（不读配置文件、不主动探测可执行文件）、`d2c6a28e4`（装前先问层级）

**本仓现状**（`packages/skill-presets/install-ability/SKILL.md`）：

- 第 28 行只禁止**改**注册表，没禁止**读** `mcp.json`；缺"查看已装内容只用 `*.query`（密钥已脱敏）"这条。
- 第 142 行仍是"起不来时，先把 `command args` 在终端手跑一次看报错"，
  与上游"get 能返回配置即视为装好，只在用户要求排错或确实起不来时才手跑"不同。
  这条是**安全**要求（避免模型自己启动用户的二进制做握手），不是文案偏好。
- 完全没有"装到哪一层"的 §1.1：没有"没说清且有项目时先问"，没有
  "项目层密钥只允许 `${VAR}` 引用"，也没有"市场 skill 目前只能装全局"的如实说明。

**改法**：

- `6d2h`（可立即做）：补"禁止直接读 `~/.astravia/agent/mcp.json` 等配置文件"，
  验证步骤改成"`mcp.query get` 返回配置即算装好"，手跑命令降级为排错手段。
- `4b7x`（**必须等 §3.5 的 scope 落地**，否则技能会教模型传一个不存在的字段）：
  增 §1.1 层级判定表 + 报告里写明落在哪一层 + 市场 skill 只能全局的说明；
  `ability.json` 同步描述。
- 文档站对应页面（`apps/docs-site` 的 MCP 产品页）同步一句"可装全局或项目层"。

**验证**：技能是提示词，没有单元测试。核对方式：`SKILL.md` 的示例 JSON 能被
`manageSchema` 校验通过（`scope:"project"` 示例必须合法）；把这条当作 §3.5 合同测试的一部分。

### 3.7 model-select `129g` 宿主各处选择器与输入栏同源（待对齐，已有 ADR-0168）

**上游**：`332ea2735`（ADR-0168 第 1 节已把方案写死，实施按那份文档，不重复设计）

**本仓现状**（与 ADR-0168 判断一致，此处只补核对结果）：

- `apps/desktop/src/renderer/shared/components/ModelSelect/ModelSelect.tsx` 385 行，
  自绘 `DropdownMenu` + 分组子菜单 + 自带搜索 + `motion` 开合；
  `useModelOptions.ts` 自带分组与 `iconFor`。**没有** `useModelPickerModel`。
- `ModelSelectorTrigger` 没有 `variant: "inline" | "field"`。
- 下游调用点（`ImBridgeSettingsView`、`ModelsDefaultModelSection`、
  `KnowledgeBaseSettingsView`、`SchedulerTaskFieldsView`、`BatchProjectRuntimeFields`）
  各自套 `triggerClassName`。

**差距**：整套 B10 第一步未做。**注意**：`SchedulerTaskFieldsView` 已因 §3.9 换过一次皮肤，
实施 129g 时两处会碰同一个文件，建议**先做 §3.9 再做 129g**，避免二次改。

**验证**：`ModelSelect.test.tsx` 期望改成"渲染 `ModelSelectorView`"；
五个调用点各自有一例断言触发器形态（inline/field）与选中回写。

### 3.8 plugin-sdk `pan7` / `r81i`（待对齐，依赖 3.7）

**上游**：`738949766`（SDK `ModelPicker` 经 host bridge 渲染宿主组件）+ `e4042b282`（定版 0.3.12）+
`5a0fce85a`（`menuClassName`）

**本仓现状**：

- `packages/plugins/plugin-sdk/package.json` 仍是 `0.3.11`；`src/` 下没有 `model-picker.ts`；
  `host-bridge.ts` 没有 `ModelPicker` 字段。
- 宿主侧 `apps/desktop/src/renderer/domains/plugins/runtime/` 没有 `PluginModelPicker.tsx`；
  `main/plugins/plugin-protocol.ts` 的 bridge 清单里没有它。

**注意本仓的两处既有差异**（照抄上游会错）：

1. `menuClassName` 在本仓的落点是 `ModelSelectorView` 的 `classNames.content`
   （本仓用 `Popover` 而不是 `DropdownMenu`，ADR-0159），不是 `DropdownMenuContent` 的 className。
2. 收藏在本仓是**视图内部**（`astravia-model-favorites` localStorage），不是 hook 提供；
   `ModelPicker` 不要新增 `favorites` prop，否则出现两套收藏事实源。

**改法**：按 `docs/dev/alignment-spec-b10-model-picker.md` 的 D1–D4 差异表逐项改写，
顺序：SDK 类型 + host bridge 字段 → 宿主 `PluginModelPicker`（读 bridge）→
`plugin-protocol.ts` 注入 → SDK 定版 `0.3.12` → 文档 `docs/plugin/ai.md`。
`r81i` 的 `menuClassName` 与 `pan7` 同一个提交做，不要留"先没有后补"。

**验证**：

- `PluginModelPicker.test.tsx`：宿主渲染、选中回吐 modelKey、`menuClassName` 落到内容面、
  旧宿主（bridge 无该字段）时抛"宿主版本过低"而不是 `undefined is not a function`。
- `plugin-sdk/test/model-picker.test.ts`：props 透传。

### 3.9 automation `10e8` 详情面板皮肤（部分对齐）

**上游**：`d85b5d25c`（六个文件）

**本仓已做**（不要重做）：

- `AutomationFieldRows.tsx`：`MotionSelect` 行尾下拉已换、`FieldGroup` 已是 `text-[15px] font-semibold` + `bg-card` +
  `border-border`、`FieldRow` 已是 `justify-between gap-6` + `truncate font-medium` + hint `text-[12px]`、
  `chipClass` 已是 `bg-muted` / `hover:bg-accent`。
- `AutomationDetailPane`：`openChat` 已按 `bhy8` 收进「更多」下拉，不在底栏；
  `discard` 的 `variant` 仍是
  `ghost`（见下表）。

**仍未做**（逐处，全部在 `apps/desktop/src/renderer/domains/scheduler/` 与 `packages/theme-ui`）：

| 位置 | 现状（精确 class 片段） | 目标 |
| --- | --- | --- |
| `AutomationFieldRows.tsx` 的 `rowInputClass`（:67） | `h-7 rounded-md border border-border/50 bg-background/60 px-2 text-[12px] …` | `` `h-8 rounded-lg border px-2.5 text-foreground outline-none focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-primary/30 [color-scheme:light_dark] ${INPUT_FILL_CLASS}` `` |
| `SchedulerTaskFieldsView.tsx:131` `ModelSelect` 的 `triggerClassName` | `h-7 border-transparent bg-transparent px-2 text-muted-foreground hover:bg-accent` | `h-8 bg-muted text-[12px] text-foreground hover:bg-accent` |
| `SchedulerTaskFieldsView.tsx:192-195` webhook 开关 chip | `flex h-7 … rounded-md border px-2`；选中 `border-primary/40 bg-primary/10`，未选中 `border-border/50` | `flex h-8 … rounded-lg px-2.5`；选中 `bg-primary/15 text-primary`，未选中 `bg-muted text-foreground hover:bg-accent` |
| `SchedulerTaskFieldsView.tsx:223` 变量插入按钮 | `bg-accent/50 … hover:text-foreground` | `bg-muted … hover:bg-accent hover:text-foreground` |
| `SchedulerTaskFieldsView.tsx:235` 通知模板 `textarea` | 手写 `rounded-md border border-border/50 bg-background/60 px-2.5 py-2 font-mono text-[12px] focus:outline-none` | `cn(TEXTAREA_FILL_CLASS, "w-full resize-y font-mono")` |
| `schedule-picker/ScheduleEditorView.tsx:293` cron 域按钮 | `h-7 … rounded-md border border-border/50 bg-background/60 px-2` | `h-8 … rounded-lg bg-muted px-2.5` + `hover:bg-accent` |
| `packages/theme-ui/src/scheduler/ExecutionHistoryView.tsx:105` | `overflow-hidden rounded-xl border border-border` | 加 `bg-card` |
| `AutomationDetailPane.tsx:96` 放弃修改按钮 | `variant="ghost"` | `variant="field"` |

**前置检查**：两个填充类名（`INPUT_FILL_CLASS` / `TEXTAREA_FILL_CLASS`）已从
`packages/ui/src/index.ts:51` 导出，无需新增。

**验证**：`AutomationDetailPane` / `SchedulerTaskFieldsView` 的组件测试断言 class 组（本项目
既有做法是断 `className` 包含关键 token），外加一条"编辑后保存仍走同一 `onChange`"的行为断言
——只断样式会漏掉误删回调。

### 3.10 三个外置插件改用宿主 `ModelPicker`（`v01k` / `qzkn` / `jhbp`）

**上游**：`cc2d14711`（content-creation）、`05df907dd`（chinese-chess）、`efa5addf4`（kanban）

**本仓现状**：

- `packages/plugins/presets/content-creation/src/prompt-optimization/PromptOptimizationControl.tsx:41-72`：
  `Popover` + `@astravia-org/ui` 的 `Select` 自己拼选项。
- `packages/plugins/externals/chinese-chess/src/components/ModelPicker.tsx`：原生 `<select>`，
  自己 `listModels()` 拉目录。
- `packages/plugins/externals/kanban/src/components/ModelPicker.tsx`：直接用
  `theme-ui/plugin-ui` 的 `ModelSelectorView`，自己把模型映射成 `ModelSelectorProviderGroup`、
  自己实现"跟随默认"哨兵（`INHERIT_KEY`）。

**判定**：kanban 是**等价实现，但不是合同对齐**——它把"数据怎么拼"留在插件侧，
SDK 一改它就跟不上（上游正是为此才做 `ModelPicker`）。因此 `jhbp` 应记为
"等价实现（待随 §3.8 收敛）"，不要记成"已对齐"。

**改法**：等 §3.8 落地后，三处各删掉本地适配层，改成
`<ModelPicker value onChange variant="field" menuClassName={...} />`。
kanban 的"跟随默认"语义改走 SDK 的 `emptyOption`；`menuClassName` 在画布 z-index 高的场景
（节点编辑器）必须显式抬高，否则菜单被盖住。

**验证**：三处各自一例：打开选择器 → 宿主目录里的模型可见 → 选中回吐 key；
kanban 额外一例：选"跟随默认"回吐空串。构建侧确认插件 bundle 没有把
`theme-ui` 的业务入口打进产物（用现有 MF 构建告警即可判断）。

## 4. 待决议：品牌与产品身份（12 条，其中 1 条不阻塞、已提前到 P9）

这一组不是技术对齐，采纳即采用上游的品牌资产。用户已明确要采纳，但**采纳需要素材与产品口径**，
所以列清了"要什么、放哪、改哪里"，决策打勾后即可施工。

### 4.1 Magpie 本机代理（5 条：`5ckc` `renp` `bnje` `lajl` + ui `0ri8`）

**上游定义**（`360e3d81d`、`05a22efd3`、`5eb4463dd`、`f52cefabc`、`8f73f02d2`）：
一个指向 `http://127.0.0.1:3425/v1` 的预设服务商，`api: openai-completions`，
`defaultApiKey: "magpie"`（本机代理免填 key），模型清单取它自己的 `/models`；
后续三条把它从"可改整条地址"收成"只开放端口"、给预设行加启用开关、加连通性测试、
编辑改成弹窗；图标换成正式 logo（单色遮罩、随主题文字色）。

**本仓现状**：`apps/desktop/src/main/models/presets/catalog.ts` 只有 8 个云端预设
（claude / openai / deepseek / zai / kimi / grok / qwen / gemini），
没有 `defaultApiKey` 机制，`PresetProviderRow` 也没有启用开关与连通测试。

**这里要分两级看**（建议这样拆，避免把"通用能力"和"某个具体代理"绑死）：

| 级别 | 内容 | 是否受品牌决议阻塞 |
| --- | --- | --- |
| 通用能力 | `PresetProviderDef.defaultApiKey`、预设行启用开关（`Switch`）、连通性测试按钮、编辑弹窗（端口 vs 整条地址两种形态） | **不阻塞**，是本仓缺的通用能力，可以先做 |
| 具体预设 | `magpie` 这一条目录项 + `/models` 拉取 + 免填 key + 图标 + i18n | 阻塞在"是否随包分发第三方 logo" |
| 素材 | `packages/theme-ui/src/shared/provider-icon/magpie.svg`（上游是单色遮罩） | 阻塞同上；若决议不做，图标位用通用"本机"图标兜底 |

**结论**：把这 5 条拆成"通用预设能力"（进正常批次）与"Magpie 预设项"（等决议），
不要整组挂在"需产品决策"上等。

### 4.2 像素白鼬应用图标与 Dock 图标（7 条）

**上游素材清单**（`cd4db961d` 起）：

| 路径 | 内容 | 数量 |
| --- | --- | --- |
| `apps/desktop/build/app-icons/*.png` | 10 款场景图标的方形版（约 7.4KB / 512px） | 10 |
| `apps/desktop/build/app-icons/*-mac.png` | 同 10 款的 824 本体 + 投影版（约 52KB） | 10 |
| `apps/desktop/src/renderer/domains/settings/assets/app-icons/` | 设置页预览图（`default` + 10 款） | 11 |
| `apps/desktop/build/icon-dock.png` | 默认 Dock 图标，1024 边距版（919KB，本仓现为 18KB 的 256 满铺版） | 1 |

**这些图标是上游的品牌吉祥物**（像素风白鼬，各带职业配件）。本仓现在用的是自有紫色轨道图标
（`apps/desktop/build/icon.png`），与上游完全不同的品牌。

**逐条判定**：

| 条目 | 依赖 | 能否用本仓自有素材完成 |
| --- | --- | --- |
| `fdho` 外观设置新增「应用图标」，可切 10 款 | 20 张场景图标 | ✘ 需决议 |
| `btmv` 单个入口 + popover + 超椭圆 | `fdho` | ✘ 同上 |
| `d1vl` 放到新会话页装饰之上、左右排列 | `fdho` | ✘ 同上 |
| `dl89` 图标四周加内边距 | `fdho` | ✘ 同上 |
| `dtza` 并入语言/外观/大小那一组 | `fdho` | ✘ 同上 |
| `e7nz` Dock 图标自带超椭圆遮罩与标准边距 | `-mac` 变体；默认图标 | **部分**：默认图标可用本仓图标重导出 |
| `izqa` Dock 默认图标改 824 本体与边距 | 仅默认图标 | ✔ **可以立刻做**：用本仓 `icon.png` 重导出 1024 画布 + 824 本体 + 投影，替换 `build/icon-dock.png` |

**建议**：`izqa` + `e7nz` 的默认图标部分**现在就做**（纯画质修正、与品牌无关，且 Dock 图标
现在满铺偏大是真实缺陷）；其余 5 条等"是否采用上游吉祥物"的决议。
若不采用，可用本仓轨道图标派生一套同尺寸变体把 `fdho` 的功能做出来（图标内容是自己的），
这样"可切换应用图标"这个功能仍然对齐，只是素材不同。

**施工要点**（无论用哪套素材）：

- 持久化：`DesktopConfig` 加可选 `appIconId?: AppIconId`（`main/config/desktop-config-store.ts:42` 的
  接口）。本仓配置是版本化的（ADR-0140），但这是**新增可选字段**且未知值回落默认，
  不需要 schema 升级；解析处补 `normalizeAppIconId` 回落。
- 主进程服务：`main/app-icon/` 服务 + IPC 通道（本仓统一 `astravia:` 前缀，不要沿用上游的通道名）；
  启动时套用一次，运行期 `app.dock.setIcon` / `win.setIcon`。
- 打包白名单：`apps/desktop/scripts/build-resource-filters.mjs:6` 已放 `icon-dock.png`，
  需再加 `app-icons`（含 `*-mac.png`），并补 `build-resource-filters.node-test.mjs` 断言。
- 设置页：`AppearanceSettingsView` 增分组（按 ADR-0161 的 `SettingSection`/`SettingRow` 形态）；
  i18n 中英各 11 个图标名 + 一句说明。

### 4.3 需给决策方的三个问题（一次问清，别反复打断）

1. 是否采用上游的像素白鼬应用图标集（20 张场景图 + 11 张预览图）？若不采用，是否接受
   "功能对齐、素材用本仓自有图标派生"？
2. 是否随包分发 Magpie 的 logo 并内置指向 `127.0.0.1:3425` 的预设？只做"通用本机代理预设能力"
   也是可交付的对齐结果。
3. `icon-dock.png` 换成 1024 边距版（`izqa`）不涉及品牌，是否直接做？（建议：直接做。）

## 5. 实施批次与依赖

按"改动面小 → 合同级"排；每批独立可验证、可回滚，每批结束就把 ADR-0157 对应行改状态。

| 批次 | 内容 | 条目 | 前置 | 预估 |
| --- | --- | --- | --- | --- |
| **P0 文档一致性** | 6 条改判 + 修正证据文档 §1/§2.1 + §14 计数 | `2ux7` `imur` `egco` `llr7` `9d56` `hl6i` | 无 | 半天 |
| **P1 性能与快捷键** | 模型菜单 memo/Map/稳定引用；快捷键可配置 + 底栏提示 | `tu3l` `dkqa` | 无 | 1–2 天 |
| **P2 面板皮肤** | 自动化详情面板 8 处皮肤（§3.9 表） | `10e8` | 无（两个填充类名已就位） | 半天 |
| **P3 SSH 目录枚举** | helper + ssh-transport + remote-filesystem + IPC 透传 | `ho2s` | 无（Go 包有独立测试） | 2 天 |
| **P4 MCP 接线** | supervisor 传 `compatProjectConfigPath` + 桌面级测试 | `ro8e` | 无 | 半天 |
| **P5 MCP 层级** | 新 ADR + 服务层/IPC/合同/审批/文档 | `dqpd` → `6d2h` `4b7x` | P4（同一片文件） | 3–4 天 |
| **P6 模型选择器收敛** | ADR-0168 第一步：`ModelSelect` 改渲染宿主视图 | `129g` | P2（同改 scheduler 文件） | 3 天 |
| **P7 插件模型选择** | SDK `ModelPicker` + 定版 0.3.12 + `menuClassName` | `pan7` `r81i` | P6 | 2 天 |
| **P8 插件迁移** | 三个外置插件改用 SDK `ModelPicker` | `v01k` `qzkn` `jhbp` | P7 | 1 天 |
| **P9 Dock 图标** | 默认 Dock 图标 824 本体版 | `izqa`（+`e7nz` 默认部分） | 无 | 半天 |
| **P10 品牌采纳** | 应用图标组 + Magpie 预设 | `fdho` `btmv` `d1vl` `dl89` `dtza` `e7nz` + Magpie 5 条 | §4.3 决策 | 3 天 |

**并行度**：P1/P2/P3/P4/P9 互不冲突，可并行；P5 与 P6 都要改 scheduler/settings 之外的独立面，
也可并行；P6→P7→P8 必须串行（合同依赖）。

**每批的完成标准**（本仓既有门禁，不另立标准）：

1. `bun run check:quick -- <改动文件…>`
2. `bun run test:impact -- <改动文件…>`（P3 另跑 `go test`；P7/P8 另跑受影响插件的构建）
3. 改动的公共合同（IPC / SDK / 主题槽位）补合同测试，生产者与消费者都覆盖
4. `.github/release-notes/v<当前版本>.md` 补一条；同批多条相同性质合并成一句，不逐条罗列
5. ADR-0157 的状态列与（必要的）批次记录在同一提交内更新

## 6. ADR-0157 需要直接替换的行

把下面这些行按原样替换（`|` 分隔与现表一致）：

```text
| v0.5.73 | feat | 沙箱权限选择移入模型菜单底栏，新增 Cmd/Ctrl+P 唤起模型菜单 | 部分对齐（底栏与开合已做；快捷键仍写死 mod+p，未进可配置白名单，底栏无快捷键提示，见对齐缺口审计 §3.1） |
| v0.5.73 | perf | 模型选择菜单稳定引用并给行组件加 memo，倍率改 Map 查找 | 部分对齐（三项均未做：倍率仍 options.find、groups/labels 每渲染重建、ModelRow 未 memo，见 §3.2） |
| v0.5.76 | feat | 支持在 @ 面板中引用目录 | 部分对齐（本地项目已可用；SSH 侧 helper / ssh-transport / remote-filesystem 三段未做，见 §3.3） |
| v0.5.75 | feat | 移除通知入口，更新条改为仅有更新时出现的图标 | 保留差异：本仓消息中心接服务端 SSE 与未读计数，是真实功能，不是上游的遗留入口；上游删入口后其组件成为死代码。见 §2 与 ADR-0160 §5 |
| v0.5.79 | perf | 顶栏动作探针去重发布、useActiveConversation 只订阅所需字段，按钮组关掉背景模糊 | 已对齐（五字段派生订阅已在位，见 §2.1） |
| v0.5.75 | style | Splash 去边框改柔和外投影，蒙层效果再调淡 | 已对齐（最终态由 PANEL_SHADOW_CLASS + .overlay-backdrop 决定，与上游 v0.5.81 一致，见 §2.2） |
| v0.5.79 | feat | 插件可用按钮组与设置页同款下拉、设置项卡片，补插件文档 | 已对齐（plugin-ui 四个设置组件与组件速查均已就位；仅缺宿主 shim 可达性断言，见 §2.3） |
| v0.5.74 | feat | 桌面端与 Agent 能力接入 sse 传输 | 已对齐（余测试缺口：无 SSE 端到端用例，见 §2.4） |
| v0.5.74 | feat | 运行时支持旧式 HTTP+SSE 传输 | 已对齐（同上） |
| v0.5.74 | feat | 项目层读取时并入根目录 .mcp.json | 部分对齐（库层已实现，桌面 supervisor 未传 compatProjectConfigPath，产品里不生效，见 §3.4） |
| v0.5.75 | fix | 去掉 Splash 面板的外阴影 | 已对齐（被上游后续共享面板皮肤覆盖，见 §2.5） |
```

其余仍开放的条目（`dqpd`、`6d2h`、`4b7x`、`129g`、`pan7`、`r81i`、`v01k`、`qzkn`、`jhbp`、
`10e8`、5 条 Magpie 功能、7 条应用图标）保持现状措辞即可，但建议在状态后加"见对齐缺口审计 §x.y"，
方便下一轮直接从本文取证据。

另外：

- §14 标题「需产品决策的 11 条」改成「需产品决策的 12 条」：Magpie 组 5（`5ckc` `renp` `bnje` `lajl` + ui `0ri8`）、
  应用图标与 Dock 组 7，并注明其中 `izqa` 与 `e7nz` 的默认图标部分可用自有素材完成、
  不必等品牌决议；Splash 那一条（`hl6i`）已随上游最终态对齐，从此处移出。
  （这 12 条是登记表的分组口径；本文 §1 的“待决议 11”把已提前到 P9 的 `izqa` 单列了。）
- §15 的 `2ux7`、`egco` 两行判定作废（本文 §1.1 有证据）。
- `docs/dev/alignment-evidence-b8-b13.md` 的 §1 总表与 §2.1 同步修正，
  或在文件头加一句"`2ux7` / `egco` 的判定以对齐缺口审计 §1.1 为准"。

## 7. 未验证与风险

- **未运行**：本次审计只读代码与提交，没有启动桌面开发壳、没有跑任何测试，
  因此"是否能正常启动/类型是否通过"未验证。实施第一批前请先按惯例启动一次开发壳，
  把手上的编译错误清零再叠加改动（避免错误堆积）。
- **快照风险**：工作区有 330 项未提交改动且审计期间仍在变（ADR-0157 被并行改写）。
  `file:line` 会漂移，实施前按符号名重新定位。
- **P5 是唯一动公共合同的批次**：`mcp.manage` 的 schema 变更会让 `astravia-actions` 已发布的
  插件行为变化（新增可选字段，向后兼容），但审批弹窗的展示变化属用户可感知，发布说明要写清。
- **P6/P7 会动插件 SDK 版本**：`plugin-sdk` 从 `0.3.11` 升到含 `ModelPicker` 的版本后，
  `tenants.json` / `bun.lock` / 各外置插件声明的 `pluginApiVersion` 要一起核对，
  漏一个就是"插件在市场里装不上"。
- **品牌素材的授权口径不在本仓**：采用上游图标/logo 前需产品确认；本文只给技术落点。

## 8. 本文不覆盖的范围

以下三项不在 ADR-0157 登记表里，因此不在本审计范围；看到它们没有被列入请勿当作遗漏：

| 事项 | 为什么不在这里 | 对应可查位置 |
| --- | --- | --- |
| 侧边栏常驻、活动面板让出侧栏宽度 | 已有独立决策 | ADR-0166 |
| 重启后继续发消息出现“回复中断” | 本仓自己的会话恢复问题，上游区间内无对应变更 | 待建 ADR |
| 会话很多 / 长会话时的卡顿 | `runtime-node` 两条性能项已在登记表内且已对齐（会话文件缓存 + 重放共用），但“成百上千会话打开慢”“悬停与上下选择卡顿”需单独量测 | 本文 §3.2 只处理了模型菜单一层；其余待建 ADR |

等这三项各自立项时，可直接把本文的 §0 取源口径与 §5 完成标准当模板复用。
