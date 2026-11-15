# ADR-0168：宿主模型选择器收敛为单一事实源

## 状态

已接受、**已实施**（2026-11-15）。`129g`、`pan7`、`r81i`、`v01k`、`qzkn` 五条落到了代码，
实施位置与逐条验证见文末「实施记录」；`jhbp` 是批次编号本身，不是可实施条目。

实施前的事实：`useModelPickerModel` 不存在、`ModelSelect` 是 385 行自绘下拉、`plugin-sdk`
无 `model-picker.ts` 且版本停在 `0.3.11`、插件各自实现。实施规格见
[`docs/dev/alignment-spec-b10-model-picker.md`](../dev/alignment-spec-b10-model-picker.md)，
对应 ADR-0157 登记表的 `129g`、`pan7`、`r81i`、`v01k`、`qzkn`、`jhbp`（批次编号见表 B10）。

## 背景

同一批「选一个模型」的界面在本仓有四份实现：

| 位置 | 现状 |
| --- | --- |
| 会话输入栏 | `ModelSelectorView`（三栏、收藏、虚拟滚动，ADR-0159） |
| 设置页 / 定时任务 / 知识库 / 批量任务 / IM 桥 | `ModelSelect`（385 行自绘 `DropdownMenu` + 分组子菜单 + 自带搜索） |
| 团队面板 | `InlineModelPicker` + `ModelConfigurationPopover`，自己拼 props |
| 外置插件（看板、象棋、提示词优化） | 看板直接用 `theme-ui/plugin-ui` 的 `ModelSelectorView`；象棋是原生 `<select>`；提示词优化用 `@astravia-org/ui` 的 `Select` + `Popover` |

数据层已经统一（同一份模型目录、同一份默认模型解析），**行为层没有**：搜索、推理档位
子菜单、空值项、触发器形态各写一遍。ADR-0159 把输入栏改成三栏时，`ModelSelect` 就成
了第二套自绘下拉——它没有收藏栏、没有虚拟滚动、没有详情浮层。

同时 `plugin-sdk` 仍是 `0.3.11`，而 `registerHeaderAction` 已经要求 Plugin API
`^2.9.0`：SDK 包版本与宿主能力不对应，新增合同只躺在 `CHANGELOG.md` 的
`[Unreleased]` 里。

## 决策

### 1. 先收敛宿主内部（`129g`），再谈插件合同

顺序不可颠倒。若先加 SDK `ModelPicker`，它委托的仍是 `ModelSelect` 这套自绘下拉，
等于把「第二套实现」写进公共合同。

- `ModelSelect` 只负责**数据装配与写回**：新增
  `useModelPickerModel`（目录、收藏、推理档位、默认模型解析、触发器文案与徽标），
  视图渲染 `theme-ui` 的 `ModelSelectorView`。自绘的分组子菜单、自带搜索、行内徽标
  全部删除。
- `ModelSelectorTrigger` 增加 `variant: "inline" | "field"`：`inline` 是输入栏胶囊形态
  （现状），`field` 是设置页形态（带边框、12px、推理档位常显）。两种形态只有这一处
  实现，设置页不再各自套 class。
- 五个调用点（`ImBridgeSettingsView`、`ModelsDefaultModelSection`、
  `KnowledgeBaseSettingsView`、`SchedulerTaskFieldsView`、`BatchProjectRuntimeFields`）
  的差异只用 `variant` + `triggerClassName` 表达，不再各带一套菜单行为。

### 2. SDK 提供 `ModelPicker`（`pan7`），宿主只渲染共享视图

`plugin-sdk` 新增 `model-picker.ts`：`ModelPicker(props)` 通过
`requireBridge().ModelPicker` 渲染宿主组件，props 覆盖
`value` / `onChange` / `reasoning` / `emptyOption` / `placeholder` / `defaultModelKey` /
`autoSelectDefault` / `disabled` / `ariaLabel` / `variant` / `menuClassName`。

- **不需要新权限**：它只是渲染宿主组件，不读模型清单，与 `command.appIcon` 不同。
- 旧宿主没有 `bridge.ModelPicker` 时，`requireBridge()` 必须给出「宿主版本过低」的
  明确错误，而不是 `undefined is not a function`。
- `menuClassName` 存在的原因是菜单 portal 到 body、默认 `z-50`：插件把它放进更高层的
  浮层（对话框、活动面板）时会被盖住，只能由调用方抬高层级。

选 SDK 合同而不是继续用 `theme-ui/plugin-ui` 的 `ModelSelectorView` 作为插件入口，是因为
后者把「数据怎么拼」留在插件侧：看板现在自己把模型映射成 `ModelSelectorProviderGroup`、
自己实现「跟随默认」哨兵。语义（空值项、默认模型、推理档位）属于宿主，应该在合同里。

### 3. SDK 版本一次推进，并补清单合同测试

`plugin-sdk` 从 `0.3.11` 推到与上游 `0.3.13` 等价的档位：`registerHeaderAction`
（0.3.13 定的版）与 `ModelPicker`（0.3.12）都在 `[Unreleased]` 里，一次发布。
同批补 `manifest-permissions.test.ts` 那样的清单权限合同测试，让「声明了权限但与
API 不匹配」在插件构建期就失败。

### 4. 三个插件改用 `ModelPicker`

- `content-creation`：删掉 `usePromptOptimizationModels`（自带清单拉取与过滤）与自绘
  下拉；先确认 `ContentPromptOptimizationService` 的 `defaultModel` 不再被消费。
- `chinese-chess`：删掉原生 `<select>` 版 `ModelPicker.tsx`，改用 SDK 组件。
- `kanban`：把 `INHERIT_KEY` 哨兵映射到 SDK 的 `emptyOption` 语义，而不是自己实现。

## 备选方案

- **让 `ModelSelect` 保持自绘、只把输入栏的收藏/虚拟滚动补给它**：等于把三栏结构在
  两处各实现一次，ADR-0159 的收益打折，且下次改三栏要改两遍。
- **直接删 `ModelSelect`，所有调用点改用 `ModelSelectorView`**：五个调用点的触发器
  形态、空值项、写回时机都不同，删掉中间层会让每个调用点重复装配数据。
- **SDK 直接导出 `ModelSelectorView`**：视图需要调用方提供分组、文案、倍率口径，
  插件会实现出与宿主不同的语义；SDK 合同应该是「选模型」这件事，不是「怎么画」。

## 后果

- 正面：一个模型选择器只有一套交互；设置页与输入栏同源；插件拿到与宿主一致的行为；
  SDK 版本与宿主能力对应。
- 代价：`ModelSelect` 的 props 面收窄（`allowClear` / `clearLabel` 映射到 `emptyOption`），
  五个调用点要逐个核对写回路径；`plugin-ui` 的 `ModelSelectorView` 出口保留（看板在
  迁移前仍用它），但不再是推荐入口。
- 兼容性：插件 SDK 升到新版本后，旧宿主会明确拒绝 `pluginApiVersion` 不满足的插件；
  三个外置插件需要重新打包。
- 测试：`ModelsDefaultModelSection.test.tsx` 现在 mock 掉 `ModelSelect`，结构变化后要
  改成真实渲染 + 断言写回，否则这条用户路径没有覆盖。

## 验证

- `ModelSelect` 相关组件测试：默认模型写回、定时任务表单、知识库设置、批量任务、
  IM 桥五条调用路径各一条「选择模型 → 值写回调用方」的用例。
- `packages/plugins/plugin-sdk`：`ModelPicker` 的桥接单测（缺 bridge 时的错误）与清单
  权限合同测试。
- 三个插件各自的 `vitest`，以及在宿主内加载的冒烟（活动面板打开、选择、写回）。
- `bun run check:quick` / `bun run test:impact` 覆盖改动文件。

## 实施记录

| 条目 | 决策 | 落实位置 | 会红的用例（旧实现下失败） |
| --- | --- | --- | --- |
| `129g` 宿主同源 | §1 | 新增 `ModelSelect/useModelPickerModel.ts`（目录、默认模型、推理档位、触发器文案与倍率口径）；`ModelSelect` 从 385 行自绘下拉重写为「装配 → 渲染 `ModelSelectorView`」；`ModelSelectorTrigger` 增加 `inline` / `field` 两套形态并贯穿 `ModelSelectorView.triggerVariant`；`useModelSelectorModel` 收敛为「值写到哪」；`TeamMemberModelSelector` 改走 `ModelSelect`；`useModelOptions.iconFor` 记忆化 | `ModelSelect.test.tsx`：断言打开后是输入栏那套三栏面板（服务商栏 + 推理档位列）。旧实现是 `DropdownMenu`，没有这两个 `group`，三条全红 |
| `pan7` SDK `ModelPicker` | §2 | 新增 `plugin-sdk/src/model-picker.ts`（宿主渲染，不读清单、不需要权限）；`PluginHostBridge` 增 `ModelPicker` 字段；SDK 导出；宿主 `PluginModelPicker` 做合同到 `ModelSelect` 的映射并装进 `pluginHostBridge`；主进程 `plugin-protocol.ts` 透传，插件运行时才拿得到 | `plugin-sdk/test/model-picker.test.ts`：props 原样透传、`menuClassName` 随合同透传、旧宿主明确报错。旧实现无此文件，套件加载即失败 |
| `r81i` `menuClassName` | §2 与 §3.7 | 合同字段 → `ModelSelect.menuClassName` → `classNames.content`（Popover 内容），`className` 落 `classNames.trigger` | `PluginModelPicker.test.tsx`：`menuClassName` 必须出现在弹出面板上。把映射写成「className 当菜单类名」时红 |
| `v01k` content-creation | §4 | 删 `usePromptOptimizationModels`（自带清单拉取与过滤）与自绘 `Select`；新增 `usePromptOptimization` 只记选中的 key；`PromptOptimizationControl` 改用 `ModelPicker`（`autoSelectDefault` + `menuClassName="z-[110]"`）；`plugin.json` 去掉 `ai.models.list`；删两条随之作废的文案键 | `test/prompt-optimization-model-picker.dom.test.tsx`：面板里出现宿主选择器、选中回调带 key、`autoSelectDefault` 与浮层层级。旧实现渲染 `@astravia-org/ui` 的 `Select`，无 `ModelPicker` 可断言 |
| `qzkn` chinese-chess | §4 | 删原生 `<select>` 版 `ModelPicker.tsx`；两处调用改用 SDK 组件，「默认」映射成 `emptyOption`；`ChessRuntime` 与 `createChessRuntime` 去掉 `listModels`；`plugin.json` 去掉 `ai.models.list`；测试桩同步 | `test/model-picker.dom.test.tsx`：`emptyOption` / `placeholder` / `ariaLabel` 必须传到宿主选择器，选默认回调 `null`。旧组件不接受这些字段，断言必红 |

SDK 版本：`0.3.11 → 0.3.13`，`CHANGELOG.md` 把累积的 `[Unreleased]` 一次定版（含
`registerHeaderAction` 与本条的 `ModelPicker`），`bun.lock` 的 workspace 版本同步。
插件文档同步：`docs/plugin/ai.md` 增「让用户选模型：`ModelPicker`」一节并把「展示选择器
就要 `ai.models.list`」改成上游口径；`docs/plugin/styling-and-pitfalls.md` 在 `plugin-ui`
一节加「只是选一个模型时不要自己拼 `ModelSelectorView`」。

### 与本 ADR 原决策的偏差（已核实，非漏做）

1. **`kanban` 不在本次范围**：它仍在树内（`packages/plugins/externals/kanban`），
   `src/components/ModelPicker.tsx`（118 行，自拼 `ModelSelectorView` + `INHERIT_KEY` 哨兵）
   也还在。本次只做了任务指定的五条，`kanban` 属 §4 的第三条（`efa5addf4`），
   留待单独一批；迁移时按「`INHERIT_KEY` → `emptyOption`、空串 ↔ `null` 往返」执行。
2. **`InlineModelPicker` / `ModelConfigurationPopover`（团队会话输入栏）不在本批**：与原
   §1 的口径一致（规格 D4 的 ②），仍是独立形态。`TeamMemberModelSelector` 属 ③，已收敛。
3. **`reasoningModelKeys` 未引入**：本仓视图用 `menuLevels.length === 0` 判断是否关闭菜单，
   与原决策「不要为对齐新增该 prop」一致。
