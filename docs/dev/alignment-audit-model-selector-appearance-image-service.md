# 三处专项对齐审计：模型选择器 / 设置-外观 / Agent 图片服务

> **本文是修订 ADR 与实施改法的唯一依据。** 只覆盖三处专项：
> ① 模型选择器（玻璃样式、预设服务商开关）；② 设置 → 外观（应用图标、圆角容器下拉、多余描述文本）；
> ③ Agent 自定义图片服务。每条给出**上游 0.5.72–0.5.81 的最终实现**（不是中间态）、**本仓当前差距**、
> **可执行的改法与可失败的验证**。
>
> 上游基线：`open-vetta` `v0.5.81` = `488724ad8`。判定只认源码与 i18n 资源实际内容，
> 不按提交标题、不按 ADR 状态列。

## 0. 取源口径与一个必须知道的前提

| 项 | 值 |
| --- | --- |
| 上游 | `v0.5.72..v0.5.81`，259 个提交；三处涉及的提交共 14 个（下表） |
| 本仓 | `main` @ `367cb3ea0` + 工作区未提交改动 |
| 采集时间 | 2026-11-14 09:30–10:05 |

**前提：本仓 `AppearanceSettingsView.tsx` 在审计期间被并行修改**（mtime 09:50:13）。
第一次读取时该文件还没有「应用图标」行、语言与界面大小行还带 `description`；
第二次读取时这些都已补上。**本文只以第二次（更新后）的读取结果为准**，
`file:line` 仍会继续漂移，实施前请按符号名定位。

三处对应的上游提交：

| 主题 | 提交 | 说明 |
| --- | --- | --- |
| 玻璃材质 | `61ad85b8f` → `4176f2934` → `7759a3b9c` | 三次迭代，**最终态以 `7759a3b9c` 为准** |
| 预设服务商开关 | `05a22efd3` | `disabled` 全链 + 行内开关 |
| 停用后从模型列表消失 | `4fc6e8058` | 渲染层过滤 + 默认模型回落 |
| 预设解析复用 | `5037aa5aa` | 保留 `reasoning_levels` 等网关参数 |
| 预设连通测试 / 编辑弹窗 | `5eb4463dd` | 模型行测试按钮 + 弹窗编辑 |
| 预设只开放端口 | `f52cefabc` | 依赖本机代理类预设，见 §1.5 |
| 外观应用图标 | `cd4db961d` `57987fb87` `d08b59d2a` `21ddb1c79` `a11c7f952` | 五步，**最终态是`a11c7f952`** |
| 下拉宽度自适应 | `c76347969` | 「下拉带边框且宽度各写各的」→ 宽度改自适应 |
| 外观页统一设置项 | `c9c4bba29` `30f28a28e` `93e1534c6` `8aa7ad699` `ea7415715` `d650bb956` `e5a7d5a3d` `dd74f1ff6` | 行高、分区、同皮 |
| 精简说明文案 | `4432d062b` | 40 余条描述，中英同步；含自定义图片服务 |

## 1. 模型选择器

### 1.1 玻璃样式：三条提交的最终态

上游走了一个来回，最终**把自绘的玻璃装饰全部删掉**，只留半透明底色 + 背景模糊：

| 提交 | 做了什么 | 是否留在最终态 |
| --- | --- | --- |
| `61ad85b8f` | 加毛玻璃：`bg-background/70` + `backdrop-blur` + 饱和度 | 底色被后续压低 |
| `4176f2934` | 深色下看不出效果 → 压到 50%，**补内描边 + 顶部高光** | ✘ 描边与高光被删 |
| `7759a3b9c` | 「上一版用描边、高光和阴影去弥补透明度，并不是真的透」→ 底色 40%、模糊 2xl，**删掉 `shadow-2xl`、`ring-1 ring-inset ring-white/10` 和那层 `bg-gradient` 高光** | ✔ **这就是最终态** |

**上游 `v0.5.81` 的实际类名**（`packages/theme-ui/src/chat/ModelSelectorView.tsx:471`）：

```text
w-auto min-w-[180px] max-w-[calc(100vw-2rem)] overflow-visible bg-background/40 p-0 backdrop-blur-2xl backdrop-saturate-150
```

配套约束（同提交的测试断言）：`className` 不含 `ring-white`，`innerHTML` 不含 `bg-gradient`。

### 1.2 本仓差距

本仓 `packages/theme-ui/src/chat/ModelSelectorView.tsx:286-291`：

```text
w-[min(34rem,calc(100vw-2rem))] min-w-[20rem] max-w-[34rem] overflow-visible
border border-transparent bg-background/60 p-0 shadow-xl backdrop-blur-2xl backdrop-saturate-150 dark:border-border/60
```

逐项对比：

| 项 | 上游最终态 | 本仓 | 判断 |
| --- | --- | --- | --- |
| 底色不透明度 | `bg-background/40` | `bg-background/60` | 差 20 个百分点，**明显更实**，背后内容透不出来 |
| 阴影 | 无（只继承基础面的柔和投影） | `shadow-xl`（硬阴影，**叠在**基础面投影之上） | 多一层，正是上游删掉的那层 |
| 描边 | 无 | `border border-transparent` + `dark:border-border/60` | 深色下多一圈实描边，正是上游判为「假装玻璃」的东西 |
| 模糊 / 饱和 | `backdrop-blur-2xl backdrop-saturate-150` | 相同 | 已对齐 |

**关键提醒（容易改错的地方）**：本仓的 `PopoverContent` 基础类已经带了
`FLOATING_SURFACE_CLASS = rounded-2xl bg-popover … dark:ring-1 dark:ring-white/10 + PANEL_SHADOW_CLASS`
（`packages/ui/src/utils.ts:34`）。所以：

- 只删 `shadow-xl` **不够**，还会剩基础面的柔和投影——这是上游也有的，**保留是对的**；
- 但 `dark:ring-1 dark:ring-white/10` 与我们的 `dark:border-border/60` 会叠成**双边缘**（描边 + 环），
  必须把自绘的那条 `border`/`dark:border` 删掉，而不是删基础环。

### 1.3 改法

`packages/theme-ui/src/chat/ModelSelectorView.tsx` 的内容面类名替换为：

```text
w-[min(34rem,calc(100vw-2rem))] min-w-[20rem] max-w-[34rem] overflow-visible
bg-background/40 p-0 backdrop-blur-2xl backdrop-saturate-150
```

即：删 `border border-transparent`、`dark:border-border/60`、`shadow-xl`；`bg-background/60 → /40`。
注释一并改掉（现在的注释写着「深色下靠一圈极淡描边与背景分开」，与上游最终结论相反）。

模型详情浮层（`ModelSelectorMenuPanel.tsx:129`）同批次对齐，差两处：

| 项 | 上游（`ModelSelectorView.tsx:1096`） | 本仓 |
| --- | --- | --- |
| padding | `p-3` | `p-2.5` |
| 饱和度 | `backdrop-blur-xl backdrop-saturate-150` | `backdrop-blur-xl`（缺 saturate） |

### 1.4 验证（要能真失败）

新增/改写在 `packages/theme-ui/src/chat/ModelSelectorView.test.tsx`（该文件已有 3 例，用 jsdom）：

```ts
it("面板是毛玻璃材质：半透明底色加背景模糊，不叠自绘描边与阴影", () => {
  // 打开菜单后取内容面
  expect(content.className).toContain("bg-background/40");
  expect(content.className).toContain("backdrop-blur-2xl");
  expect(content.className).not.toContain("shadow-xl");
  expect(content.className).not.toContain("dark:border");
  expect(content.innerHTML).not.toContain("bg-gradient");
});
```

改回 60% 或加回 `shadow-xl`/`dark:border` 必须变红。**只断 `backdrop-blur` 不算覆盖**——
那一条本仓本来就是对的，永远绿。

### 1.5 预设服务商开关：上游是五层链路，不是一颗 Switch

`05a22efd3` 的动机是「预设服务商填 key 后只能删除不能暂停」，所以 `disabled` 必须一路打穿到运行时，
否则会出现「界面上关了、模型还在被调用」。

| 层 | 上游改动 | 本仓 |
| --- | --- | --- |
| 配置 schema | `packages/coding-agent/src/models/configuration/model-config-schema.ts`：`ProviderModelConfigSchema` 增 `disabled: Type.Optional(Type.Boolean())` | ✘ **无 `disabled`** |
| 配置加载 | `local-model-config.ts`：`filter(([name, provider]) => !validation.skip.has(name) && !provider.disabled)` | ✘ 只按 `validation.skip` 过滤 |
| 主进程服务 | `model-settings-service.ts`：`ProviderConfig` 增 `disabled?`；`listProviders()` 的 `providers.map` 前插 `.filter(([, provider]) => !provider.disabled)` | ✘ 无该字段、无过滤 |
| 渲染层选项 | `useModelOptions.ts`：`flattenModels` 里 `if (providerConfig.disabled) continue;`；`defaultKey` 在默认模型所属服务商被停用时返回 `undefined` | ✘ 两处都没有 |
| 行内 UI | `PresetProviderRowView`：`Switch size="sm"` 放行尾操作区；徽标条件由 `row.adopted` 改 `row.enabled`；`canEditKey = !offline && !autoKey` | ✘ 无 `Switch`，徽标仍是 `row.adopted` |
| 模型侧 | `usePresetProvidersSectionModel`：`enabled: adopted && !config.providers[row.id]?.disabled`；`toggleEnabled` 只翻转 `disabled`，**保留密钥与模型** | ✘ 无 |

**本仓为什么要这条**：现在想暂停某个已采纳的预设服务商，只能「删除」，
而删除会 `delete providers[row.id]` 并清掉 `defaultModel`（`usePresetProvidersSectionModel.ts:328-344`），
密钥与模型配置一起没了，无法撤销。这是真实可用性缺陷，不是审美问题。

**改法**（按层做，每层可独立编译）：

1. `model-config-schema.ts` 增 `disabled`；
2. `local-model-config.ts` 的 filter 加 `!provider.disabled`；
3. `model-settings-service.ts` 的 `ProviderConfig` 增 `disabled?: boolean`，`listProviders` 加 filter；
4. `preload/api-types/models.ts` 的 `ModelsConfigData.providers[*]` 增 `disabled?: boolean`
   （它是跨进程合同，漏了第 5 步就编译不过，正好当守卫）；
5. `useModelOptions.ts`：
   - `flattenModels` 里跳过 `disabled`；
   - `defaultKey`：`defaultModel` 的第一个 `/` 之前是 provider id，若该 provider `disabled` 则返回 `undefined`
     （上游用 `defaultModel.split("/", 1)[0]`）；
6. `usePresetProvidersSectionModel.ts`：row 增 `enabled`，加 `toggleEnabled`
   （已采纳 → 只翻 `disabled`；未采纳 → 不处理「关」；「开」走原来的 adopt）；
   labels 增 `toggleProvider: (name) => t("toggleProvider", { provider: name })`；
7. `PresetProviderRowView.tsx`：徽标条件 `row.adopted → row.enabled`；行尾加 `Switch`；
8. i18n：`zh|en settings.json` 增 `toggleProvider`（形如「启用 {{provider}}」）。

**关于 `defaultApiKey` / `autoKey`（本机代理免填 key）**：上游是为 Magpie 加的。
本仓没有 Magpie 预设，且是否随包分发第三方 logo 尚未决议（见品牌身份 ADR-0172）。
**建议这一批不做 `defaultApiKey`**，只做 `disabled`；等 Magpie 决议落地时再加
（届时 `canEditKey = !offline && !autoKey` 与「内置密钥走启用校验」一起补）。

**验证**：

- `model-settings-service.test.ts`：写入 `disabled: true` 后 `listProviders()` 不含该 provider；
- `useModelOptions.test.tsx`：`disabled` 的 provider 不出现在 `options`/`grouped`；
  默认模型属于禁用 provider 时 `defaultKey === undefined`；
- `PresetProviderRowView` 组件测试：`enabled: false` → Switch 未选中、**不显示「已启用」徽标**；
  点 Switch 回调收到 `false`；
- 回归：`toggleEnabled` 之后 `providers[id].apiKey` 与 `models` 仍在（**这是本条的核心语义**，
  只断 Switch 会漏掉把密钥删掉的错误实现）。

### 1.6 顺带两条同源差距（同属「预设服务商」，一并做更省事）

**① 预设解析没复用接口解析器**（`5037aa5aa`，本仓缺）

本仓 `apps/desktop/src/main/models/presets/fetch.ts:172-183` 的 `parseOpenAICompatibleModel`
只认 `context_length` / `supports_reasoning` / `supports_image_in`。
`apps/desktop/src/main/models/parse-provider-models.ts` **已存在但没被它调用**。
后果：聚合网关用 `reasoning_levels` / `modalities` / `max_output_tokens` 写法时，
思考档位、模态、输出上限被静默丢弃——用户看到「这个模型的思考强度没了」。

改法：按上游那样取 `const rich = parseProviderModels({ data: [raw] })[0]`，
`supports_*` 明确给出时优先，其余回落到 `rich` 的 `reasoningLevels` / `maxTokens` / `contextWindow` / `vision`。

**② 模型行没有连通测试**（`5eb4463dd`，本仓缺；但基础设施已在）

- 上游：`PresetProviderModelsListView` 每行末尾一个测试按钮，三态
  `testing`（转圈禁用）/ `ok`（绿勾）/ `fail`（红三角 + `title` 显示错误），
  `onTest` 缺省时不渲染（服务商未采纳，无从探测）；行内还显示 `reasoningLevels`
  （`思考 · low/medium/high`）。
- 本仓：`PresetProviderModelsListView.tsx` 无 `onTest`、`row.modelRows` 无 `reasoningLevels` 与 `test`。
  **但**探测能力已经具备：`main/models/probe.ts` 的 `probeModelProvider` +
  IPC `astravia:models:probe`（`ipc/fs.ts:164,545`），且「拉取模型」抽屉
  （`ModelsFetchedModelsDrawer.tsx:90`）已在用 `onTestFetchedModel`。

改法：把抽屉那套 `onTest` 接线搬到预设列表——新增纯逻辑
`preset-model-test-state.ts`（`idle → testing → ok|fail`，同一模型并发只保留一次请求），
UI 照上游 `ModelTestControl` 三态实现。**不需要新的主进程能力**。

**③ 只开放端口（`f52cefabc`）暂不做**：它把「改整条地址」收成「只改端口」，前提是存在
`http://127.0.0.1:<port>` 形态的本机代理预设。本仓没有这种预设，做出来就是一个用不上的弹窗。
等 §1.5 的 Magpie 决议一起判断。

## 2. 设置 → 外观

### 2.1 应用图标：**大部分已在工作区里，只差两处**

先纠正一个容易误判的地方：我在上一份缺口审计（§4.2）里写「需从零实现」是**过时的**。
工作区里已有未跟踪（`??`）的完整实现：

| 上游落点 | 本仓状态 | 证据 |
| --- | --- | --- |
| `apps/desktop/build/app-icons/{10 款}.png` + `{10 款}-mac.png`（20 张） | ✔ 已存在 | `ls apps/desktop/build/app-icons/` |
| `apps/desktop/src/renderer/domains/settings/assets/app-icons/`（11 张预览） | ✔ 已存在 | 同上 |
| `apps/desktop/src/shared/app-icon.ts`（`APP_ICON_IDS` / `normalizeAppIconId`） | ✔ 已存在 | 文件在，`useAppearanceSettingsModel.ts:19` 引用 |
| `main/app-icon/app-icon-service.ts` | ✔ 已存在 | `main.ts:16` 导入、`:737` 调 `applyAppIcon()` |
| `main/ipc/app-icon.ts` + `ipc/index.ts` 注册 | ✔ 已存在 | `ipc/index.ts:46,120` |
| `preload/api-types/app-icon.ts` + `apis/app-icon.ts` + `api.ts`/`index.ts` 装配 | ✔ 已存在 | `api.ts:153`、`index.ts:34,66` |
| `DesktopConfig.appIconId` + `normalizeAppIconId` 回落 | ✔ 已存在 | `desktop-config-store.ts:68,360` |
| 外观页四行（语言/模式/界面大小/应用图标） | ✔ 已存在 | `AppearanceSettingsView.tsx:652-690`，`appearance-app-icon` 是最后一行 `border={false}` |
| `AppIconPicker` + `SquircleIcon`（n=5 超椭圆 clip-path） | ✔ 已存在 | 同文件 `SquircleIcon`/`AppIconPicker` |
| i18n `appIcon_default…appIcon_sleep`（中英各 11 条） | ✔ 已存在 | `zh|en settings.json` |
| `SETTINGS_SECTION["appearance-app-icon"]` | ✔ 已存在 | `registry.ts:106` |
| Dock 默认图标 824 本体版（`izqa`） | ✔ 已完成 | `build/icon-dock.png` 1024×1024、919KB，已入库 |
| **打包白名单** | ✘ **缺** | `build-resource-filters.mjs` 只有 `icon-dock.png`，没有 `app-icons` |
| **白名单断言** | ✘ **缺** | `build-resource-filters.node-test.mjs` 未覆盖 |

**那条缺失是真实缺陷，不是收尾项**：`app-icon-service.ts` 从
`join(process.resourcesPath, "build")`（打包态）读 `app-icons/<id>.png`。
白名单不放进 `app-icons`，打包后的应用里这些文件不存在 →
`nativeImage.createFromPath` 返回空图 → `appIconImage()` 静默返回 `undefined` →
**用户点选图标没反应，且没有任何报错**。开发态（`process.cwd()/build`）正常，所以很难发现。

**改法**：

1. `apps/desktop/scripts/build-resource-filters.mjs`：`filters` 增 `"app-icons/*.png"`；
2. `build-resource-filters.node-test.mjs`：断言各平台家族的 filters 都含 `app-icons/*.png`；
3. 冒烟：`bun run build:desktop`（或至少 `node scripts/build-resource-filters.mjs` 的输出检查）
   后确认 `resources/build/app-icons/` 有 20 个文件。

**验证**：`node --test apps/desktop/scripts/build-resource-filters.node-test.mjs`；
打包冒烟按仓库既有发布流程在 CI 里做，本地只需要白名单断言绿。

### 2.2 圆角容器下拉：问题是「宽度各写各的」，不是皮肤

上游 `c76347969` 的原文动机：「控件样式东一块西一块：**下拉带边框且宽度各写各的**……
下拉宽度改为自适应，面板按选项内容撑开」。

- **皮肤已对齐**：本仓 `SELECT_TRIGGER_CLASS = border border-transparent bg-muted hover:bg-accent data-[state=open]:bg-accent focus-visible:border-primary/50`
  与上游逐字相同（`packages/ui/src/select.tsx:11-13`）；
  `MotionSelect` 触发器（`h-8 w-fit … rounded-lg px-2.5 text-[12px]`）与面板宽度策略
  （`w-max min-w-[var(--radix-popover-trigger-width)] max-w-[min(360px,…)]`）也与上游一致。
- **宽度没对齐**：本仓在外观页的四个触发器上手写固定宽度。

| 位置 | 本仓 | 上游最终态 |
| --- | --- | --- |
| 语言下拉 `LanguageSelect` | `triggerClassName="w-[260px]"`（`:68`） | 无（`w-fit` 自适应） |
| 外观模式 `ModeSelect` | `triggerClassName="w-[180px]"`（`:437`） | 无 |
| 界面大小 `UiZoomPopover` 触发器 | `w-[84px]`（`:490`） | 无（`:71` 只有 `h-8 … rounded-lg px-2.5`） |
| 装饰/纹理 `DecorPicker` 触发器 | `w-[150px]`（`:625`） | `w-fit`（`:581`） |

上游曾用过 `w-[150px]`（`93e1534c6`），随后在 `c76347969` 里明确删掉——理由是
「原先 260px 的宽度对三五个选项过宽」。本仓正好停在**删除前**那个状态。
视觉后果：语言那行触发器比内容宽出一大截、右侧留白失衡；四项放在同一张卡片里宽度还不一致。

**改法**：四处删掉固定宽度，交给 `w-fit`。`UiZoomPopover` 的 `%` 文本本身很短，
自适应后不会跳动（`tabular-nums` 已在）。字体行 `min-w-[140px] shrink-0` 保留——
字体是**本仓自有功能**（上游无此块），且它的选项文案长度差异大，给下限是合理的；
但要在注释里写明「这是本仓自有的最小宽度，不是写死的定宽」。

**验证**：`AppearanceSettingsView.test.tsx` 增一例——渲染后四个触发器
（`aria-label` 分别为「语言」「外观」…按现有 label 取）的 `className` **不含 `w-[`**；
这是能真失败的稳定断言，不依赖像素。

### 2.3 多余描述文本：行内 description 已清，剩下的是**死管道**

当前状态（第二次读取）：

| 位置 | 现状 | 判断 |
| --- | --- | --- |
| 语言行 | 已无 `description` | ✔ 与上游一致（上游没有 `languageHint` 这个概念） |
| 界面大小行 | 已无 `description` | ✔ 与上游一致 |
| 新会话页装饰（section + 两项） | `newSessionDecorHint` / `ornamentHint` / `textureHint` 仍在 | ✔ **与上游一致，不要删**（上游 `v0.5.81` 保留这三处） |
| 字体块 | `SettingHeading「字体」` + 行标签「界面字体」+ 触发器 | 双层标题，本仓自有功能，见下 |

**真正没清掉的是管道**：`languageHint` 与 `uiZoomHint` 的 i18n 键、
`AppearanceSettingsModel.labels` 字段、`useAppearanceSettingsModel` 里的 `t()` 调用都还在，
但**视图已经不消费**。`fontHint` 更彻底：`FontSelectRow` 的 `hint?` 形参还在，
调用点不传，i18n 键没人读。

| 死物 | 位置 |
| --- | --- |
| `languageHint`（zh/en 文案 + 接口字段 + `t("languageHint")`） | `settings.json`、`useAppearanceSettingsModel.ts:130,365` |
| `uiZoomHint`（同上） | `settings.json`、`useAppearanceSettingsModel.ts:150,366` |
| `fontHint`（zh/en 文案 + 未使用的形参） | `settings.json`、`AppearanceSettingsView.tsx:236`（`FontSelectRow` 的 `hint?`） |

**改法**：三组一起删干净——i18n 键（中英各 3 条）、接口字段、`t()` 调用、`FontSelectRow` 的 `hint?` 形参。
「界面大小」这一行不再有说明文字，信息由「界面大小 + 百分比 + 弹层里的滑块」自解释：
这既符合上游最终态，也符合「收敛到界面大小下方」的要求（该行只剩标题与控件）。

**字体块的双层标题**：`SettingHeading「字体」` + 行标签「界面字体」说的是同一件事。
建议保留 `SettingHeading`（与其他分区一致的视觉节奏）、把行标签精简为「界面字体」之外的
更短表述或直接去掉行标签只留触发器；这是本仓自有设计，**上游无对应依据**，属于产品判断而非对齐——
如果只要求「去冗余」，最小改动是删掉 `SettingHeading`、把该行并进上一张卡片，
但那会破坏「一张卡片=一组同质偏好」的结构，**不建议**。请在这一处给一个明确取舍。

**验证**：`check:quick` 会拦下未使用的 i18n 键（若仓库有此守卫）；
组件测试断言外观页渲染后**不含**「调整整个界面的显示比例」这句文案。

## 3. Agent 自定义图片服务

### 3.1 先说一个必须纠正的前提

**它不在 0.5.72–0.5.81 的对齐范围内。** 证据：

- `apps/desktop/src/main/media-generation/custom-image-provider-manager.ts` 的引入提交是
  `078f081f6 feat(desktop): 支持自定义 OpenAI 兼容生图服务`，**在 `v0.5.72` 之前**；
- `git cat-file -e v0.5.72:…/custom-image-provider-manager.ts` → 存在；
- `git log v0.5.72..v0.5.81 -- apps/desktop/src/main/media-generation/ apps/desktop/src/renderer/domains/settings/components/useImageGenerationSettingsModel.ts` → **零提交**。

所以它不属于 ADR-0157 的「0.5.72→0.5.81 每个行为变更」。它是
**上游早就有的功能，本仓这条分支从未移植**。窗口内只碰到了它的两处外圈：
`4432d062b`（文案精简）与 `c76347969`（皮肤统一，删了 `triggerClassName="min-w-[220px]"`）。

这决定了 ADR 怎么写：**不能**记成「对齐 0.5.72–0.5.81 的某条」，否则登记表又会多一条
对不上提交的假条目。应作为「补齐上游既有能力」单独立项。

### 3.2 上游实现全貌（`v0.5.81`）

| 层 | 文件 | 要点 |
| --- | --- | --- |
| 数据合同 | `preload/api-types/media.ts` 的 `CustomImageProviderInput`、`media.customImageProviders.{list,save,remove}` | 按 OpenAI 兼容 `/images/generations` + `/images/edits` 建模 |
| 主进程 | `main/media-generation/custom-image-provider-manager.ts` | 注册/注销 provider；**API Key 走加解密落盘**；解密失败按未配置处理并 warn；配置读失败按空列表 |
| provider | `main/media-generation/openai-compatible-image-provider.ts` | `customImageProviderId(id)` 命名空间隔离，避免与内置 provider 撞 id |
| IPC | `main/ipc/media.ts` | 三个通道，输入经 `parseCustomImageProviderInput` 校验 |
| 注册中心 | `main/capabilities/media-providers.ts` | 与内置 provider 同一注册表，`dispose()` 统一回收 |
| 渲染模型 | `useImageGenerationSettingsModel.ts`（400 行） | `custom: { draft, providers, startAdd, startEdit, updateDraft, save, cancel, remove, error, labels }` |
| UI | `ImageGenerationSettingsSection.tsx`（188 行） | 两个路由下拉 + `CustomProviderList`（列表 + 行内编辑/删除）+ `CustomProviderForm`（内联表单，不是弹窗） |
| i18n | `zh|en settings.json` 的 `agent.imageGeneration.custom.*` | 名称/Base URL/API Key/model/支持文生图/支持图生图 |

上游表单字段：`name`、`baseUrl`、`apiKey`（password，已存过则提示「留空沿用」）、`model`、
两个 `CheckboxField`（`supportsTextToImage` / `supportsImageToImage`）。
列表行显示 `name · model` 与 `baseUrl`，行尾「编辑 / 删除」两个纯文字按钮。

### 3.3 本仓差距

| 层 | 本仓 | 差距 |
| --- | --- | --- |
| 主进程 | `grep -rl customImageProviders apps/desktop/src` → **0 个文件** | 全缺 |
| 合同 | `preload` 无 `customImageProviders` | 全缺 |
| 渲染模型 | `useImageGenerationSettingsModel.ts` 228 行，只有两条路由 + 安装入口 | 无 `custom` 分支 |
| UI | `ImageGenerationSettingsSection.tsx` 104 行 | 无 `CustomProviderList` / `CustomProviderForm` |
| i18n | 无 `agent.imageGeneration.custom.*` | 全缺 |

本仓还多了一个上游没有的兜底：`ImageRouteSelect` 在「只有自动选择」时
（开源构建没有内置 provider）不禁用下拉，而是下方给「去能力页安装」链接。
这是本仓的合理差异（我们的 provider 来自能力市场），**移植时保留**。

### 3.4 两条路线（需要你选一条）

| | 路线 A：只对齐窗口内 | 路线 B：完整移植自定义图片服务 |
| --- | --- | --- |
| 内容 | ①文案精简（`4432d062b` 对 `agent.imageGeneration.*` 那几条）；②删 `triggerClassName="min-w-[220px]"`，改自适应 | A + 主进程 manager + provider + IPC + 合同 + 渲染模型 `custom` 分支 + UI 表单 + i18n + 加解密复用 |
| 改动面 | 2 个文件（i18n、section） | 约 10 个文件，其中 3 个新增；需要复用现有 credential 加解密 |
| 与 ADR-0157 的关系 | 记入 settings 批次的「文案/皮肤」条目 | **不能**记入 ADR-0157；单独立项 |
| 风险 | 无 | 中：密钥存储必须复用现有 credential store，不能新写一套加密；provider 注册要在 `dispose` 时回收，否则热重载残留 |
| 建议 | 先做 | 作为独立批次排期 |

**本仓当前的具体可做项（路线 A）**：

1. `ImageGenerationSettingsSection.tsx`：两个 `ImageRouteSelect` 的
   `triggerClassName="min-w-[220px]"` 删掉（上游 `c76347969` 删了同样的两行）；
2. i18n：`agent.imageGeneration.description` 与 `custom.description` 按上游精简版改写
   （上游原文：「Agent 生成或编辑图片时的默认模型；自动选择跟随可用服务」/
   「添加兼容 OpenAI 的图片服务，保存后可在上方下拉中选择。API Key 加密存储在本机。」）；
3. 保留「去能力页安装」兜底，并在注释里写明这是本仓与上游的差异。

**如果选路线 B**，施工顺序与验证：

1. 合同：`preload/api-types/media.ts` 增 `CustomImageProviderInput` 与三个方法（生产者/消费者一起改）；
2. 主进程：manager + provider，**密钥复用 `main/models/model-credential-store.ts` 那类现成机制**，
   不新写加解密；`media-providers.ts` 里注册并在 `dispose()` 回收；
3. IPC：`ipc/media.ts` 三个通道，输入校验函数单独可测；
4. 渲染模型：`custom` 分支 + 纯函数 `toCustomProviderView()`（列表展示用的派生逻辑，可单测）；
5. UI：列表 + 内联表单（照上游形态，`Button variant="field"` 与 `CheckboxField` 本仓已有）；
6. i18n 中英各 8 条。

验证重点（按风险排序）：
- 密钥不被回显（`list` 不含明文，只给 `hasStoredApiKey`）；
- 保存后注册中心里能查到该 provider、删除后消失（`dispose` 不残留）；
- Base URL 非法时不崩溃、只报错；
- 表单「名称/BaseURL/model 必填」校验。

## 4. 优先级与批次

| 批次 | 内容 | 耗时 | 依赖 |
| --- | --- | --- | --- |
| **X1** | 玻璃样式（1 个类名 + 详情浮层 2 处）+ 玻璃断言 | 1h | 无 |
| **X2** | 外观：四处固定宽度删掉 + 三个死键/死参数清理 + 断言 | 2h | 无 |
| **X3** | 应用图标打包白名单 + 断言（**功能已就绪，不做就发不出**） | 1h | 无 |
| **X4** | 预设 `disabled` 五层 + Switch + `toggleProvider` | 1 天 | 与 X5 同片文件，建议合并 |
| **X5** | 预设解析复用 `parseProviderModels` + 模型行连通测试 | 1 天 | 与 X4 同片文件 |
| **X6** | 图片服务路线 A（宽度 + 文案） | 1h | 无 |
| **X7** | 图片服务路线 B（完整移植） | 3 天 | 需先定路线 |

X1/X2/X3/X6 互不冲突、都是小改动，可以一次做完再统一验证。
X4+X5 建议同一批（都动 `usePresetsProvidersSectionModel` 与两个 view 文件，分两批会互相踩）。
`AppearanceSettingsView.tsx` 正在被并行修改，X2 动手前请先 `git status` 确认没有第二个改这份文件。

## 5. 对 ADR 的修订建议

| ADR | 现状问题 | 建议 |
| --- | --- | --- |
| **0159**（模型选择器三栏） | 全文没有一处提到玻璃材质；而 ADR-0157 的 `v88g`/`w2oj`/`wk36` 三条标「已对齐（B3 续）」 | 补一节「玻璃材质」：写下 `bg-background/40 + backdrop-blur-2xl + backdrop-saturate-150`、**明确不要**自绘描边/硬阴影/高光，并注明这是上游 `7759a3b9c` 的最终结论（前两次迭代已被自己推翻） |
| **0161**（设置与外观） | 未覆盖应用图标、未记录下拉宽度策略、把 `languageHint`/`uiZoomHint` 当成果落地 | ① 补「应用图标」小节（含打包白名单这条硬约束）；② 补「下拉宽度一律自适应，禁止在调用点写死 `w-[…]`」；③ 删除关于 `languageHint`/`uiZoomHint` 的描述，或改记为「已移除」 |
| **0157** 登记表 | `v88g` `w2oj` `wk36` 标「已对齐」但实际是 60%+shadow-xl+深色描边；`dtza` `d1vl` `btmv` `dl89` `fdho` 标「需产品决策」但图标素材已进工作区 | 按 §1、§2 的事实改写；五个应用图标条目从「需产品决策」改为「已实现（待打包白名单）」 |
| **0172**（品牌身份） | 把应用图标 20 张全部当成待决议素材 | 注明「素材已随工作区引入，剩余工作是打包白名单与外观行接线」，把决议范围收窄到 **Magpie logo 与本地代理预设** |
| 新增 | 自定义图片服务没有归属（既不在 0157 窗口内，也没有独立记录） | 新建 ADR（下一个可用号 **0175**）：「补齐上游已有的自定义图片服务」；若只做路线 A，则并入 0161 的 settings 条目，不新立 |

## 6. 未验证与风险

- **未运行任何测试、未启动桌面壳**。本文是静态审计；X3 的打包缺陷只有真打一次包才能最终确认。
- `AppearanceSettingsView.tsx` 与 `useAppearanceSettingsModel.ts` 在审计期间被并行修改，
  本文对这两份文件的 `file:line` 是第二次读取时点的快照；动手前按符号名重新定位。
- §2.1 纠正了我上一份审计（`alignment-gap-audit-0.5.72-0.5.81.md` §4.2）的过时结论：
  那里写「需从零实现 5 条」，实际是「已实现、缺打包白名单」。两份文档冲突时**以本文为准**。
- 自定义图片服务（路线 B）会新增一份「图片 provider」的注册与密钥路径，
  与现有的模型凭据、MCP 密钥是**三条独立链路**；不要为了省事让它们共用一个存储文件，
  但必须共用同一套加解密实现，否则会多出一套需要单独审计的密钥处理代码。
- 上游窗口内 `4432d062b` 一次改了 40 余条描述文案（中英各 88 行）。本文只覆盖三处专项里的图片服务那几条；
  其余文案是否也要一并精简，需要单独核对 `zh|en settings.json` 的 diff，不在本次范围。
