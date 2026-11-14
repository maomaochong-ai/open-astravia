# ADR-0170：已对齐批次的审查修订（测试层级、虚拟列表定位、横幅依赖）

## 状态

已接受、已实施。修订 ADR-0160、0161、0162、0165 四份记录中被指出的缺陷与不成立的验证结论；
对应 `docs/dev/alignment-review-0160-0166.md` 的 4 条阻断与 4 条重要发现。

§1–§6 的六条决策已全部落到代码，逐条对应 `docs/dev/alignment-audit-0157-0168-0166.md`
的缺陷编号（D1–D6），实施位置见文末「实施记录」。

## 背景

审查发现的问题不是「功能没写」，而是三类系统性偏差：

1. **验证不成立**。ADR-0160 的「验证」写着跑绿，实际三个文件是红的：一个测试文件在
   `theme-ui` 里 import 了该包刻意不装的 `@testing-library/react`，两条用例的断言与本批
   自己的设计相悖（删除后落点、哪些项目有标签页）。
2. **接线丢失**。模型菜单「打开时当前模型对齐到顶部」在 `ModelSelectorView` 里声明了
   `modelListRef` 却从未挂到 DOM 上，恒为 `null`；连带搜索框的 `↓` 键被 `preventDefault`
   吞掉后什么也不做。ADR-0157 `257x` 与 ADR-0165 §2 都写着已对齐。
3. **文档与实现互相反着写**。沉浸式顶栏在源码里已完整启用（`pageHeaderImmersiveAtom` →
   `RootLayoutView` 的 `headerOverlay` → `MessageFeedLayoutView` 顶部占位与 `DefaultChatView` 的
   `pt-11` / `-mt-11` 补偿），而 ADR-0157 的
   `44o7` 记「部分对齐」、`hhe6` 记「不适用」、`vld7` 记「待对齐」，ADR-0165 的「后果」
   把页头浮层化当作未实施方案在论证。上述状态已在 ADR-0157 §15/§16 回写，ADR-0165 的
   「后果」也已同步修正；本条保留作当时判断的依据。

另有一条性能回归：能力页横幅的图标依赖操作进度 Map，安装期间每 tick 重排并回到第一张。

## 决策

### 1. 测试层级按包的能力决定，不按「就近」决定

`packages/theme-ui` 不依赖 `@testing-library/*` 是既有约定（该包既有 jsdom 用例一律
`react-dom/client` + `act`）。因此：

- 需要 `testing-library` 表达断言的面板级用例，**移到 `apps/desktop`**（那里有完整配置），
  用包内公开入口渲染同一个组件；
- 留在 `theme-ui` 的用例只允许 `react-dom` + `act`。

不为一个测试给包加依赖，也不因为「文件在哪个包」就复制一套等价用例——同一个风险只由
能准确定位失败的最低层覆盖一次。

### 2. 用例服从设计，设计不从用例

两条红用例都是用例错，不是实现错：

- 删除后选中落点：实现按「落到相邻一行」移动选中项，桩件却没让列表缩短。桩件要模拟
  删除的后果（列表变短、被删项消失），否则这条行为等于没测。
- 标签页：`canTag = isDefault && !isClaw` 是 ADR-0160 §2 的明确设计——标签只属于「对话」
  档。用例改用该档项目，并另加一条「普通/Claw 项目没有标签页」的反向断言，
  让设计本身被固定下来。

### 3. 虚拟列表的定位用下标算滚动量，不用 DOM 查询

三栏中间栏是窗口化渲染，目标行未挂载时 `querySelectorAll` + `scrollIntoView` 两头都
不成立。改为：`ModelSelectorMenuPanel` 接受**要露出的模型 key**（而不是外部传 ref），
内部按行高与行下标算出 `scrollTop` 并在打开时设置一次。

同一处修掉键盘通路：搜索框的 `↓` 必须真的把焦点/选中移到第一条结果或滚动到列表，
否则不要 `preventDefault`——被吞掉又没反应的按键比没有快捷键更糟。

### 4. 横幅的内容身份与操作进度解耦

能力页横幅只需要「条目的身份与展示字段」（id、标题、图标、简介），不需要操作进度。
`bannerIcons` 改为按这些字段的签名 memo：安装进度 tick 产生新的 `operationProgressById`
时，横幅不重排、不 `setActive(0)`。`kprt` 的收益要覆盖横幅，而不只是卡片列表。

### 5. 矮窗口的可见行数由实测视口决定

管理会话面板用常量行数决定滚动窗口，矮窗口（<750px）下选中行会被滚出视口且再也回不来。
改成按容器的实测高度算可见行数与 overscan，与窗口高度变化一起重算。

### 6. 「清空默认模型」同时清掉新会话读的那份记忆

`desktop-config.defaultModel` 与 `localStorage["astravia-selected-model"]` 是两个事实源，
清空语义此前只覆盖前者：设置页显示「未设置」，新会话却仍按记忆里的模型发消息。
决策：**清空默认模型时一并删除该键**。之后用户在新会话里手动选过的模型仍会写回该键
（那是「上次选择」，不是「默认」），两个语义不混。

### 7. 状态列以代码为准回填，并在同日修正引用它的文档

`44o7` / `hhe6` / `vld7` 改为「已对齐（B8）」，ADR-0165 的「后果 / 已知限制」同步删掉
「页头浮层化未做」的论证。同时把 `257x` 在补实现前视为「部分对齐」——它的前半
（边缘渐隐）成立，后半（打开对齐到顶部）在本次修订前不成立。

## 备选方案

- **给 `theme-ui` 装上 `@testing-library/react`**：一次依赖换来一个文件的方便，
  之后包内会出现两套渲染约定，与既有 20 多个用例的写法分叉。
- **把「打开对齐到顶部」删掉、状态改回不做**：上游确实有这个行为，用户在长列表里
  找不到当前模型是真实痛点；成本只是把 ref 换成 key + 下标计算。
- **横幅继续依赖 `allItems`，只在 Banner 内部深比较**：把去重责任放到已经持有
  `Math.random` 的组件里，等于让「随机重排」和「依赖变化」互相猜。

## 后果

- 正面：ADR-0160/0162 的验证重新成立；模型菜单的打开定位与键盘通路真的可用；
  安装期间横幅不再抖动；矮窗口能滚；默认模型只有一个语义。
- 代价：`ModelSelectorMenuPanel` 的 props 增加「要露出的 key」；管理会话面板的窗口
  计算依赖实测高度，组件测试要提供可控的容器尺寸（`mock` ResizeObserver 或显式高度）。
- 兼容性：全部为内部行为，公共合同无变化。

## 验证

- `apps/desktop`：迁移后的 `ManageSessionsSplashView` 用例（长列表窗口化、方向键滚动保持可见）、
  `useManageSessionsModel`（删除后落点、标签页正反两条）、`useAbilitiesModel`（横幅标题
  与卡片标题共存时用限定容器断言）、`useModelsSettingsModel`（清空默认同时删记忆键）。
- `theme-ui`：`ModelSelectorView` / `ModelSelectorMenuPanel` 用例——打开时按 key 定位到
  目标行（含目标行在窗口外的情形）、搜索框 `↓` 后的可见结果。
- 全部改动文件过 `bun run check:quick` 与 `bun run test:impact`。

## 实施记录

审计报告 `docs/dev/alignment-audit-0157-0168-0166.md` 判定「决策写了、代码没有」的六条，
现按缺陷编号逐条落实。每条用例都先在旧实现上确认失败，再改实现转绿。

| 缺陷 | 决策 | 落实位置 |
| --- | --- | --- |
| D1 | §3 | `ModelSelectorMenuPanel` 新增 `revealModelKey`，按行高与行下标算 `scrollTop` 并在打开时设置一次；对外暴露 `focusFirstModel` / `focusLastModel` 供搜索框方向键使用。`ModelSelectorView` 删除从未挂到 DOM 的 `modelListRef` 与 DOM 查询，`↓` 只有在真的移动到某一行时才 `preventDefault`。 |
| D2 | §1 | `packages/theme-ui/src/project/ManageSessionsSplashView.test.tsx` 删除，迁移为 `apps/desktop/src/renderer/domains/project/components/ManageSessionsSplashView.test.tsx`，经 `@astravia-org/theme-ui/project` 公开入口渲染同一组件。 |
| D3 | §2 | `useManageSessionsModel.test.tsx` 的桩件改为就地缩短会话列表（删除真的生效）；标签页用例改用「对话」档项目，并补「普通项目不提供标签页」的反向断言。 |
| D4 | §4 | `useAbilitiesModel` 的 `bannerIcons` 改为按 `id/type/icon/title/description` 签名缓存：安装进度 tick 让 `allItems` 换引用时，横幅池子保持同一数组。 |
| D5 | §5 | `ManageSessionsSplashView` 用 `ResizeObserver` 实测列表容器高度，窗口区间与滚动跟随都用实测值；`MANAGE_SESSIONS_LIST_HEIGHT` 退回纯上限角色。 |
| D6 | §6 | `useModelsSettingsModel.onChangeDefaultModel` 在清空时 `removeItem` 记忆键（键名改用 `SELECTED_MODEL_STORAGE_KEY`，不再写第二份字面量）。 |

新增/迁移的用例：

- `packages/theme-ui/src/chat/ModelSelectorView.test.tsx`：第 80 行的当前模型打开后可见（旧实现下该行根本不挂载）、搜索框 `↓` 后焦点落在第一行、无匹配时不吞键。
- `apps/desktop/src/renderer/domains/project/components/ManageSessionsSplashView.test.tsx`：窗口化只挂可见区间、80 行以内全量、**矮窗口（实测 200px）按真实视口算窗口**、空态、行尾「更多」不误开行。
- `apps/desktop/src/renderer/domains/project/hooks/useManageSessionsModel.test.tsx`：删除后列表真的变短且选中项落到相邻一行；「对话」档有标签页、普通项目没有。
- `apps/desktop/src/renderer/domains/abilities/hooks/useAbilitiesModel.stability.test.tsx`：安装进度 tick 后 `allItems` 换引用、`bannerIcons` 保持同一数组。
- `apps/desktop/src/renderer/domains/settings/components/useModelsSettingsModel.test.tsx`：清空默认模型同时删掉 `astravia-selected-model`。

审计报告的 D7–D9 不属本 ADR 的代码范围，但已在文档侧处理完毕：

- **D7**（从外部应用打开）登记表 `qnwo` 改为「形态差异」并注明与 ADR-0171 一致，不再记成已对齐；
- **D8**（`SplashPanel` 自相矛盾）`warf` 改为「部分对齐」并写明 `CommandMenuView` 未迁移，
  ADR-0160 里悬空的条目 ID 引用已删除；
- **D9**（ADR-0168 零实现）状态改为「已接受、尚未实施」，验证段保留为验收标准，并指向实施规格。

仍待代码实现的是 ADR-0168（B10）与 ADR-0172（B14，品牌身份），两项都有独立记录与验收口径。
