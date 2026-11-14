# B10 移植规格：宿主模型选择器收敛

> 本文件只补**实现细节**：上游最终源码形态、本仓对应位置、逐项照搬 / 改写判定、批次顺序与最小验证口径。
> 结论级判断（哪些已做、哪些没做、为什么）见 [alignment-evidence-b8-b13.md](./alignment-evidence-b8-b13.md)，此处不重复。
>
> 只读上游，未修改任何源码，未运行测试。

## 0. 取源口径

- 上游 `/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta`，取 **`v0.5.81` = `488724ad8`** 的工作区文件（即三条提交之后的最终态，不是 diff 片段）。
- 三条提交与本文件的对应关系：

| 提交 | 内容 | 本文件章节 |
| --- | --- | --- |
| `332ea2735` | 129g 宿主各处模型选择器与输入栏同源 | §2 |
| `738949766` + `e4042b282` | pan7 SDK `ModelPicker` + 定版 0.3.12 | §3 |
| `5a0fce85a` | r81i `menuClassName` | §3.7 |
| `cc2d14711` / `05df907dd` / `efa5addf4` | 三个插件迁移 | §4 |

- 关于最终态的证据：`useModelPickerModel.ts` 在区间内只被 `332ea2735` 改过；
  `ModelSelect.tsx` 被 `332ea2735` 与 `5a0fce85a` 改过（后者加 `menuClassName`）；
  `ModelSelectorTrigger.tsx` 被 `332ea2735` 与 `5a2a82f29` 改过（后者把 `field` 形态改成
  `SELECT_TRIGGER_CLASS` 无边框皮肤，属本仓 ADR-0161 的 B5 范围，已落地）。
  下文所有代码块均为这三处叠加后的 `v0.5.81` 形态。

## 1. 两侧结构差异（决定改写量的四处）

这四处差异不是风格问题，会直接改变移植代码的形状，先写清楚。

| # | 主题 | 上游 v0.5.81 | 本仓现在 | 影响 |
| --- | --- | --- | --- | --- |
| D1 | 选择面板容器 | `DropdownMenu`（`ModelSelectorView.tsx:447`，`role="menu"`） | `Popover`（`ModelSelectorView.tsx:263`，理由见该处注释：三栏面板不是 `menuitem` 序列，ADR-0159 决策） | 上游的测试断言 `screen.getByRole("menu")` **不能照抄**；`menuClassName` 落在 `classNames.content`（Popover 内容）而非 DropdownMenu 内容 |
| D2 | 收藏归属 | 收藏在 **hook** 里（`useModelPickerModel` 读 `favoriteModelsAtom`，以 `favorites={keys,onToggle,labels}` 传给视图） | 收藏在 **视图内部**（`ModelSelectorView.tsx:162-240`，`localStorage` 键 `astravia-model-favorites`） | 本仓的 `useModelPickerModel` **不要**提供 `favorites`；否则会出现两套收藏事实源 |
| D3 | `labels` 形状 | 嵌套：`labels.info = { button, source, id, contextWindow, maxOutput, inputModes, reasoning, reasoningSupported, multiplier, modality }` | 扁平：`labels.infoButton / infoProvider / infoId / infoVision / infoMultiplier / infoDefault / infoYes / infoNo`（`ModelSelectorView.tsx:47-86`） | `labels` 映射要按本仓字段逐项写，不能整段照搬 |
| D4 | 团队/插件的「同源」路径 | 只有一条：`ModelSelect`（→ `useModelPickerModel` → `ModelSelectorView`） | 三条并存：① `ModelSelect`（自绘 `DropdownMenu`，385 行）② `InlineModelPicker` + `ModelConfigurationPopover`（团队会话输入栏、`connectors/team/TeamModelSelector.tsx`）③ 直接 `ModelSelectorView`（`agent-teams/components/TeamMemberModelSelector.tsx`、kanban 插件） | 129g 只收敛 ① 与 ③；② 是团队会话输入栏的独立形态，**不在本批次范围** |

另外两处较小但必须知道的差异：

- 本仓 `useModelOptions` 的 `ModelOption` **没有** `inputModalities` / `contextWindow` / `maxTokens`
  （上游 `useModelOptions.ts:19-24` 有），所以 `labels` 里也没有对应的详情字段；移植时不要引入。
- 本仓 `useModelOptions` 的 `iconFor` 不是 `useCallback`（上游是），而 `useModelPickerModel` 的
  `groups` 用 `useMemo([grouped, iconFor, labelFor])`。移植时要顺手把 `iconFor`/`labelFor` 包成
  `useCallback`，否则每次渲染 `groups` 都换新引用，视图里的行级 memo 失效。

---

## 2. 步骤 1：129g 宿主各处模型选择器与输入栏同源

### 2.1 `useModelPickerModel.ts`（新建）

**上游** `apps/desktop/src/renderer/shared/components/ModelSelect/useModelPickerModel.ts`（253 行，全文见下）
**本仓** `apps/desktop/src/renderer/shared/components/ModelSelect/useModelPickerModel.ts`（新建，同路径）

#### 2.1.1 可直接照搬的部分（逐字）

签名、ref 化回调、推导顺序、导出工具函数都可以逐字照搬：

```ts
// 上游 useModelPickerModel.ts:1-47（导入改成本仓包名即可）
import { favoriteModelsAtom } from "@shared/store/atoms";
import { modelCatalog } from "@shared/store/model-catalog";
import type { ModelSelectorViewProps } from "@astravia-org/theme-ui/chat";
import { fmtMultiplier } from "@astravia-org/theme-ui/shared/MultiplierTag";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { type ResolvedReasoning, resolveReasoning } from "./resolveReasoning";
import { type ModelOption, useModelOptions } from "./useModelOptions";

/** 推理档位的受控值；不传就不出现第三栏。 */
export interface ModelPickerReasoning {
	readonly value: string | undefined;
	readonly onChange: (level: string) => void;
}

export interface UseModelPickerModelOptions {
	readonly value: string | null;
	readonly onChange: (key: string | null, option: ModelOption | null) => void;
	readonly reasoning?: ModelPickerReasoning;
	readonly emptyOption?: { readonly label: string };
	readonly placeholder?: string;
	readonly defaultKey?: string;
	readonly autoSelectDefault?: boolean;
}

export interface ModelPickerModel {
	readonly empty: boolean;
	readonly options: readonly ModelOption[];
	readonly globalDefaultKey: string | undefined;
	readonly catalogOption: ModelOption | null;
	readonly resolvedReasoning: ResolvedReasoning | null;
	readonly viewProps: ModelSelectorViewProps;
}
```

```ts
// 上游 useModelPickerModel.ts:233-253 —— 三个纯函数，逐字照搬
/** 目录尚未加载出该 key 时，拼一个最小 option 供触发器展示。 */
export function fallbackOptionFromKey(key: string): ModelOption {
	const slash = key.indexOf("/");
	const provider = slash > 0 ? key.slice(0, slash) : key;
	const modelId = slash > 0 ? key.slice(slash + 1) : key;
	return { provider, modelId, displayName: modelId, key };
}

/**
 * 菜单里列出的档位。「关闭思考」总是提供；模型自己声明了 "none" 时由它替代 "off"，两者不同时出现。
 */
export function reasoningMenuLevels(resolved: ResolvedReasoning | null): string[] {
	if (!resolved) return [];
	if (resolved.levels.includes("none")) {
		return ["none", ...resolved.levels.filter((level) => level !== "none" && level !== "off")];
	}
	return ["off", ...resolved.levels.filter((level) => level !== "off")];
}

export function isValidReasoningLevel(level: string, resolved: ResolvedReasoning): boolean {
	return level === "off" || level === "none" || resolved.levels.includes(level);
}
```

这三条正是本仓现在散在三个地方的重复实现，移植后必须删掉旧副本：

| 重复实现位置 | 内容 |
| --- | --- |
| `domains/conversation/hooks/useModelSelectorModel.ts:37-48` | `fallbackOptionFromKey` |
| 同文件 `:84-94` | `menuLevels` 推导 + `isValidLevel` |
| `domains/agent-teams/components/TeamMemberModelSelector.tsx:104-122` | `fallbackOptionFromKey` / `reasoningLevels` / `isValidReasoning` |
| `shared/components/ModelSelect/ModelSelect.tsx:82-96` | `menuLevels` 推导 + `isValidLevel` |

#### 2.1.2 必须按本仓结构改写的部分

上游的 `favorites`（D2）与 `labels.info.*`（D3）、`reasoningModelKeys` 都不适用。下面是**可直接落地**的本仓版本全文：

```ts
import { modelCatalog } from "@shared/store/model-catalog";
import type { ModelSelectorLabels, ModelSelectorViewProps } from "@astravia-org/theme-ui/chat";
import { fmtMultiplier } from "@astravia-org/theme-ui/shared/MultiplierTag";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { type ResolvedReasoning, resolveReasoning } from "./resolveReasoning";
import { type ModelOption, useModelOptions } from "./useModelOptions";

/** 推理档位的受控值；不传就不出现第三栏。 */
export interface ModelPickerReasoning {
	/** 当前档位；无效或缺省时按所选模型的默认档位显示。 */
	readonly value: string | undefined;
	readonly onChange: (level: string) => void;
}

export interface UseModelPickerModelOptions {
	/** 当前选中的 `provider/modelId`；null 表示未选。 */
	readonly value: string | null;
	/**
	 * 选中回调。`option` 是目录里的那一项（选空值项时为 null），调用方可据此取默认推理档位。
	 * 只有提供了 `emptyOption` 时 key 才会是 null。
	 */
	readonly onChange: (key: string | null, option: ModelOption | null) => void;
	readonly reasoning?: ModelPickerReasoning;
	/** 列表顶部的空值项（「不固定模型」「跟随默认」）。 */
	readonly emptyOption?: { readonly label: string };
	/** 未选中时触发器上的文案；缺省为「选择模型」。 */
	readonly placeholder?: string;
	/** 打「默认」徽章的模型；缺省为用户配置的全局默认模型。 */
	readonly defaultKey?: string;
	/** 未选中时自动选上全局默认模型（只触发一次 onChange）。 */
	readonly autoSelectDefault?: boolean;
}

export interface ModelPickerModel {
	/** 目录为空、没有选中值、也没有空值项：没东西可画。 */
	readonly empty: boolean;
	readonly options: readonly ModelOption[];
	/** 用户配置的全局默认模型（所属服务商被停用时为 undefined）。 */
	readonly globalDefaultKey: string | undefined;
	/** 目录里真实存在的选中项；目录未就绪或模型已下架时为 null。 */
	readonly catalogOption: ModelOption | null;
	readonly resolvedReasoning: ResolvedReasoning | null;
	readonly viewProps: ModelSelectorViewProps;
}

/**
 * 宿主唯一的模型选择器连接层：读同一份模型目录（本地 models.json + 登录后的远程目录），
 * 拼出 ModelSelectorView 需要的分组、文案与推理档位。
 *
 * 输入栏、设置页、审批卡、批量任务、团队成员、插件（经 host bridge）都从这里取 props，
 * 选择器因此只有一个数据口径与一副样子；各处只决定「选中的值写到哪」。
 *
 * 收藏不在这里：本仓的收藏状态与星标 UI 都在 ModelSelectorView 内部（localStorage 键
 * `astravia-model-favorites`），这里再提供一份会出现两套事实源。
 */
export function useModelPickerModel({
	value,
	onChange,
	reasoning,
	emptyOption,
	placeholder,
	defaultKey: defaultKeyOverride,
	autoSelectDefault = false,
}: UseModelPickerModelOptions): ModelPickerModel {
	const { t } = useTranslation("common");
	const { options, grouped, defaultKey: globalDefaultKey, iconFor, labelFor } = useModelOptions();
	const defaultKey = defaultKeyOverride ?? globalDefaultKey;
	const optionByKey = useMemo(() => new Map(options.map((option) => [option.key, option])), [options]);

	// 回调经 ref 取最新值：调用方常传内联函数，不该因此让视图的 memo 失效。
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const reasoningChangeRef = useRef(reasoning?.onChange);
	reasoningChangeRef.current = reasoning?.onChange;

	const catalogOption = value ? (optionByKey.get(value) ?? null) : null;
	// 有 key 但目录未就绪（或模型已下架）时仍显示 modelId，避免闪「选择模型」或误显示成空值项。
	const selectedOption = useMemo(
		() => catalogOption ?? (value ? fallbackOptionFromKey(value) : null),
		[catalogOption, value],
	);
	const hasReasoning = reasoning !== undefined;
	// 推理档位只认目录里的真实配置，fallback option 不参与。
	const resolved = useMemo(() => (hasReasoning ? resolveReasoning(catalogOption) : null), [hasReasoning, catalogOption]);
	const menuLevels = useMemo(() => reasoningMenuLevels(resolved), [resolved]);
	const currentLevel = resolved
		? reasoning?.value && isValidReasoningLevel(reasoning.value, resolved)
			? reasoning.value
			: resolved.default
		: undefined;

	useEffect(() => {
		if (!autoSelectDefault || value || !globalDefaultKey) return;
		onChangeRef.current(globalDefaultKey, optionByKey.get(globalDefaultKey) ?? null);
	}, [autoSelectDefault, value, globalDefaultKey, optionByKey]);

	const handleModelSelect = useCallback(
		(key: string) => onChangeRef.current(key, optionByKey.get(key) ?? null),
		[optionByKey],
	);
	const handleReasoningSelect = useCallback((level: string) => reasoningChangeRef.current?.(level), []);
	// 打开菜单时按 TTL 后台重校验目录，服务端增删模型无需重启即可看到。
	const handleOpenChange = useCallback((open: boolean) => {
		if (open) void modelCatalog.revalidate();
	}, []);

	const emptyLabel = emptyOption?.label;
	const viewEmptyOption = useMemo(
		() => (emptyLabel === undefined ? undefined : { label: emptyLabel, onSelect: () => onChangeRef.current(null, null) }),
		[emptyLabel],
	);

	const levelLabel = useCallback(
		(level: string) => t(`modelSelect.reasoningLevel.${level}`, { defaultValue: level }),
		[t],
	);
	/** 计费倍率的口径与「免费」措辞属于宿主，视图只负责渲染。 */
	const multiplierLabel = useCallback(
		(option: { key: string }): string | undefined => {
			const multiplier = optionByKey.get(option.key)?.multiplier;
			if (!multiplier) return undefined;
			return multiplier.input === 0 && multiplier.output === 0
				? t("modelSelect.free")
				: t("modelSelect.multiplier", { value: fmtMultiplier(multiplier.input) });
		},
		[optionByKey, t],
	);

	// 引用保持稳定：视图里的搜索过滤依赖它们不随无关状态换新。
	const groups = useMemo(
		() =>
			[...grouped.entries()].map(([provider, models]) => ({
				icon: iconFor(provider),
				label: labelFor(provider),
				models,
				provider,
			})),
		[grouped, iconFor, labelFor],
	);
	const labels = useMemo<ModelSelectorLabels>(
		() => ({
			clearSearch: t("modelSelect.clearSearch"),
			multiplierLabel,
			cloudOnly: t("modelSelect.cloudOnly"),
			defaultBadge: t("modelSelect.defaultBadge"),
			levelLabel,
			modelHeader: t("modelSelect.modelHeader"),
			noResults: t("modelSelect.noResults"),
			noResultsHint: t("modelSelect.noResultsHint"),
			placeholder: placeholder ?? t("modelSelect.placeholder"),
			reasoningHeader: t("modelSelect.reasoningHeader"),
			searchPlaceholder: t("modelSelect.searchPlaceholder"),
			visionBadge: t("modelSelect.visionBadge"),
			// 收藏星标与收藏栏由 ModelSelectorView 自己渲染，文案仍从这里给。
			favoritesHeader: t("modelSelect.favoritesHeader"),
			favorite: t("modelSelect.favorite"),
			unfavorite: t("modelSelect.unfavorite"),
			searchResultsHeader: t("modelSelect.searchResultsHeader"),
			// 行尾详情浮层（本仓是扁平字段，上游是 labels.info.*）。
			infoButton: t("modelSelect.info.button"),
			infoProvider: t("modelSelect.info.provider"),
			infoId: t("modelSelect.info.id"),
			infoVision: t("modelSelect.info.vision"),
			infoMultiplier: t("modelSelect.info.multiplier"),
			infoDefault: t("modelSelect.info.default"),
			infoYes: t("modelSelect.info.yes"),
			infoNo: t("modelSelect.info.no"),
			fewerProviders: t("modelSelect.fewerProviders"),
		}),
		[t, multiplierLabel, levelLabel, placeholder],
	);

	return {
		empty: options.length === 0 && !value && !emptyOption,
		options,
		globalDefaultKey,
		catalogOption,
		resolvedReasoning: resolved,
		viewProps: {
			currentLevel,
			defaultKey,
			emptyOption: viewEmptyOption,
			groups,
			labels,
			menuLevels,
			onModelSelect: handleModelSelect,
			onOpenChange: handleOpenChange,
			onReasoningSelect: handleReasoningSelect,
			selectedModel: value ?? undefined,
			selectedOption,
		},
	};
}
```

要点（与上游的差异，逐条可核对）：

1. 去掉 `favorites`（D2）。
2. `labels` 用本仓扁平 `info*` 字段（D3），并补本仓必需但上游没有的 `favoritesHeader` /
   `favorite` / `unfavorite` / `searchResultsHeader`（本仓 `ModelSelectorLabels` 里是必填）。
3. 去掉 `reasoningModelKeys`：本仓 `ModelSelectorView` 用「`menuLevels.length === 0` 才关闭」
   判断（`ModelSelectorView.tsx:250-253`），没有这个 prop。**不要为了对齐新增该 prop**，
   那会扩大视图合同且与现有行为重复。
4. `reasoningMenuLevels` / `isValidReasoningLevel` / `fallbackOptionFromKey` 三个函数从
   上游原样搬过来并 `export`，供 `useModelSelectorModel` 与 `ModelSelect` 复用。

### 2.2 `ModelSelect.tsx`（整份重写，385 → 约 95 行）

**上游** `apps/desktop/src/renderer/shared/components/ModelSelect/ModelSelect.tsx`（94 行）
**本仓** 同路径（现 385 行，自绘 `DropdownMenu` + 搜索框 + 推理子菜单）

#### 上游全文（可直接照搬结构）

```tsx
// 上游 ModelSelect.tsx:1-94
import { useThemeComponent } from "@vetta-org/theme-sdk";
import { type ModelSelectorTriggerVariant, ModelSelectorView } from "@vetta-org/theme-ui/chat";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { type ModelPickerReasoning, useModelPickerModel } from "./useModelPickerModel";
import type { ModelOption } from "./useModelOptions";

/** Optional reasoning-level column for a model picker. Controlled by the caller. */
export type ModelSelectReasoning = ModelPickerReasoning;

export interface ModelSelectProps {
	value: string | null;
	onChange: (key: string | null) => void;
	/** Show an explicit "unset" entry so the selection can be cleared */
	allowClear?: boolean;
	clearLabel?: string;
	ariaLabel?: string;
	disabled?: boolean;
	placeholder?: string;
	/** Extra classes for the trigger button (sizing/shape per call site) */
	triggerClassName?: string;
	/** Extra classes for the popup menu (e.g. a higher z-index inside a raised overlay) */
	menuClassName?: string;
	/** 触发器形态；表单里默认 `field`（带边框的选择框）。 */
	variant?: ModelSelectorTriggerVariant;
	/** 打「默认」徽章的模型；缺省为全局默认模型。 */
	defaultKey?: string;
	/** When value is empty, auto-apply the configured default model once */
	autoSelectDefault?: boolean;
	/** Fires whenever the resolved selected option changes (load + change) */
	onSelectedOptionChange?: (option: ModelOption | null) => void;
	/** When set, adds a reasoning-level column for the selected model. */
	reasoning?: ModelSelectReasoning;
}

export function ModelSelect({ /* …全部 props… */ }: ModelSelectProps): JSX.Element {
	const { t } = useTranslation("common");
	const ThemedModelSelectorView = useThemeComponent("chat.modelSelectorView", ModelSelectorView);
	const emptyLabel = allowClear ? (clearLabel ?? t("modelSelect.unset")) : undefined;
	const emptyOption = useMemo(() => (emptyLabel === undefined ? undefined : { label: emptyLabel }), [emptyLabel]);
	const model = useModelPickerModel({
		value,
		onChange: (key) => onChange(key),
		reasoning,
		emptyOption,
		placeholder,
		defaultKey,
		autoSelectDefault,
	});

	// Surface the resolved selected option to consumers (e.g. image support).
	const onSelectedOptionChangeRef = useRef(onSelectedOptionChange);
	onSelectedOptionChangeRef.current = onSelectedOptionChange;
	const optionCount = model.options.length;
	useEffect(() => {
		if (optionCount === 0) return;
		onSelectedOptionChangeRef.current?.(model.catalogOption);
	}, [model.catalogOption, optionCount]);

	if (model.empty) return <></>;
	return (
		<ThemedModelSelectorView
			{...model.viewProps}
			ariaLabel={ariaLabel}
			disabled={disabled}
			triggerVariant={variant}
			classNames={{ trigger: triggerClassName, content: menuClassName }}
		/>
	);
}
```

#### 本仓版本（可落地）

只需两处调整：包名 `@vetta-org` → `@astravia-org`；`t("modelSelect.unset")` 本仓已有该键
（`locales/zh/common.json:979`、`en` 同名）。其余逐字相同，因此可直接按上面写。

**必须删掉的东西**（重写后不再需要，逐项核对，避免留死代码）：

| 本仓现位置 | 内容 | 处理 |
| --- | --- | --- |
| `ModelSelect.tsx:1-14` | `ProviderIcon` / `DropdownMenu*` / `DropdownMenuSub*` / `ThemeSurface` / `motion` / `AnimatePresence` 等导入 | 删除 |
| `ModelSelect.tsx:18-60` | `ModelSelectReasoning` / `ModelSelectProps`（无 `menuClassName`/`variant`） | 用上游签名替换 |
| `ModelSelect.tsx:68-105` | `catalogOption` / `selectedOption` / `resolved` / `menuLevels` / `isValidLevel` | 全部移入 `useModelPickerModel` |
| `ModelSelect.tsx:107-125` | 自建 `groups` + `filteredGroups` 搜索过滤 | 删除（视图内部自己有搜索，`ModelSelectorView.tsx:126-140` 的 `normalizeSearchValue` 等） |
| `ModelSelect.tsx:127-131` | `autoSelectDefault` 的 effect | 删除（已进 hook） |
| `ModelSelect.tsx:154-190` | `handleOpenChange`（含 `setReasoningOpen`/`setSearchQuery`）、打开时 `scrollIntoView`、搜索键盘处理 | 删除 |
| `ModelSelect.tsx:~196-385` | 整个 `DropdownMenu` 渲染树 | 删除，换成单行 `<ThemedModelSelectorView ... />` |
| `ModelSelect.tsx` 的 `MODEL_ITEM_SELECTOR` 常量 | 搜索焦点管理 | 删除 |

**保留的行为（不得回退）与新引入的行为（需实机确认）**：

1. **主题覆盖点（本仓是新增，不是保留）**：本仓 `ModelSelect` 现在**没有**
   `useThemeComponent("chat.modelSelectorView")`，它是自绘 `DropdownMenu`，只在面板里放了
   `<ThemeSurface slot="chat.modelSelectorMenu" />`（`ModelSelect.tsx:233`）与
   `slot="chat.modelSelectorReasoningMenu"`（`:287`）。走 `useThemeComponent` 的只有输入栏
   （`domains/conversation/components/ModelSelector.tsx:22`）。重写成上游形态后，设置页/审批卡/插件的
   选择器**都会**经过 `chat.modelSelectorView` 覆盖点 —— 这是行为变化，收益是主题定制一次生效、
   成本是外部主题若手写了针对设置页的样式可能叠加。落地时用 `useThemeComponent`（照上游），
   并在验证里确认设置页选择器外观无意外变化。
2. `onSelectedOptionChange` 的「目录就绪后才回调」语义（`optionCount === 0` 时 return），
   消费方是输入栏的图片能力标记（`useModelSelectorModel` 里 `setModelSupportsImages`）。
3. `model.empty` 时不渲染任何内容（`return <></>`），语义变化见 §6 第 2 条。

同时更新 barrel：

```ts
// apps/desktop/src/renderer/shared/components/ModelSelect/index.ts —— 改为上游 index.ts 的形态
export { ModelSelect, type ModelSelectProps, type ModelSelectReasoning } from "./ModelSelect";
export { type ModelOption, type UseModelOptionsResult, useModelOptions } from "./useModelOptions";
export {
	type ModelPickerModel,
	type ModelPickerReasoning,
	type UseModelPickerModelOptions,
	useModelPickerModel,
} from "./useModelPickerModel";
```

### 2.3 `ModelSelectorTrigger.tsx`：variant 与两套类名（逐字）

**上游** `packages/theme-ui/src/chat/ModelSelectorTrigger.tsx`（63 行）
**本仓** 同路径（38 行，无 `variant`）

```tsx
// 上游 ModelSelectorTrigger.tsx:1-33
import { SELECT_TRIGGER_CLASS } from "@vetta-org/ui";
import { cn } from "@vetta-org/ui/utils";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef } from "react";
import { ProviderIcon } from "../shared/provider-icon";

/**
 * 触发器的形态。
 * - `inline`：输入栏里的无边框小胶囊，随输入栏容器宽度截断模型名。
 * - `field`：表单里的选择框（设置页、弹窗、插件表单），带边框，推理档位常显。
 */
export type ModelSelectorTriggerVariant = "inline" | "field";

interface ModelSelectorTriggerProps extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
	readonly label: string;
	readonly icon?: string;
	readonly reasoningLabel?: string;
	readonly variant?: ModelSelectorTriggerVariant;
}

const VARIANT_CLASS: Record<ModelSelectorTriggerVariant, string> = {
	// The input bar is a CSS container: truncate the name before wrapping its toolbar.
	inline:
		"max-w-[5.5rem] gap-1 rounded-full border border-transparent px-1.5 py-0.5 text-[11px] text-foreground data-[state=open]:bg-accent/60 data-[state=open]:text-foreground @[22rem]:max-w-[9rem] @[28rem]:max-w-[13rem]",
	// 表单里的选择框与设置页下拉同源（SELECT_TRIGGER_CLASS）：无边框 + 底色。
	field: `h-8 max-w-full gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${SELECT_TRIGGER_CLASS}`,
};

const REASONING_CLASS: Record<ModelSelectorTriggerVariant, string> = {
	inline:
		"hidden shrink-0 rounded bg-muted/70 px-1 text-[9px] leading-[14px] text-muted-foreground @[28rem]:inline",
	field: "shrink-0 text-muted-foreground",
};
```

```tsx
// 上游 ModelSelectorTrigger.tsx:35-63
export const ModelSelectorTrigger = forwardRef<HTMLButtonElement, ModelSelectorTriggerProps>(
	function ModelSelectorTrigger({ label, icon, reasoningLabel, variant = "inline", className, title, ...props }, ref) {
		return (
			<button
				ref={ref}
				type="button"
				title={title ?? label}
				className={cn(
					"flex min-w-0 items-center transition-colors focus:outline-none focus-visible:outline-none",
					VARIANT_CLASS[variant],
					className,
				)}
				{...props}
			>
				<ProviderIcon symbol={icon} className={variant === "field" ? "h-3.5 w-3.5 shrink-0" : "h-3 w-3 shrink-0"} />
				<span className="min-w-0 flex-1 truncate text-left">{label}</span>
				{reasoningLabel ? <span className={REASONING_CLASS[variant]}>{reasoningLabel}</span> : null}
				<span
					aria-hidden="true"
					className={cn("icon-[solar--alt-arrow-down-linear] shrink-0", variant === "field" ? "h-3 w-3" : "h-2.5 w-2.5")}
				/>
			</button>
		);
	},
);
```

**可直接照搬**：整份文件。前提已满足 —— 本仓 `packages/ui/src/select.tsx:11` 的
`SELECT_TRIGGER_CLASS` 与上游**逐字一致**，且已从 `@astravia-org/ui` 导出（`index.ts:64`）。

**唯一需要注意**：本仓当前触发器的基类串里混了 `max-w-[5.5rem] … @[22rem]:max-w-[9rem]` 这些
inline 专属值。照搬上游后这些值只存在于 `VARIANT_CLASS.inline`，基类只剩
`flex min-w-0 items-center transition-colors focus:outline-none focus-visible:outline-none`。
**不要保留旧基类**，否则 `field` 形态会继承 inline 的 `max-w` 与胶囊圆角。

### 2.4 `ModelSelectorView` 接线（两处小改）

**上游** `packages/theme-ui/src/chat/ModelSelectorView.tsx` 在 `332ea2735` 里改了三处：

```tsx
// 上游 ModelSelectorView.tsx:16-18（新增导出）
import { ModelSelectorTrigger, type ModelSelectorTriggerVariant } from "./ModelSelectorTrigger";

export type { ModelSelectorTriggerVariant } from "./ModelSelectorTrigger";

// 上游 :128-130（props 新增）
	disabled?: boolean;
	/** 触发器形态：输入栏胶囊（默认）或表单选择框。 */
	triggerVariant?: ModelSelectorTriggerVariant;

// 上游 :212 / :450（默认值 + 透传）
	triggerVariant = "inline",
	…
					variant={triggerVariant}
```

**本仓对应位置**（`packages/theme-ui/src/chat/ModelSelectorView.tsx`）：

| 改什么 | 本仓位置 |
| --- | --- |
| 导入 `ModelSelectorTriggerVariant` 并再导出 | `:23`（`import { ModelSelectorTrigger } from "./ModelSelectorTrigger";`）+ 文件内 `export type` |
| `ModelSelectorViewProps` 加 `triggerVariant?` | `:92-124`（在 `:101` `disabled?: boolean;` 之后插） |
| 解构默认值 | 函数参数里 `disabled = false,` 之后（本仓当前在 `:135` 附近的 `export function ModelSelectorView({…})` 解构块） |
| 传给触发器 | `:265-275`（`<ModelSelectorTrigger … />`，加 `variant={triggerVariant}`） |

导出面（两处都要加，否则插件侧拿不到类型）：

```ts
// packages/theme-ui/src/chat/index.ts:305-313 —— 在 ModelSelectorProviderGroup 后加一行
	ModelSelectorProviderGroup,
	ModelSelectorTriggerVariant,
	ModelSelectorViewProps,
```

```ts
// packages/theme-ui/src/plugin-ui/index.ts:18-22 —— 同样加一行
	ModelSelectorTriggerVariant,
```

> 本仓 `theme-ui/src/chat/index.ts` 目前**没有**导出 `ModelSelectorTrigger` 本身（只有 `ModelSelectorView`），
> 上游也没有。保持现状，只导出类型。

### 2.5 `useModelSelectorModel.ts`（输入栏 hook 收敛）

**上游** `apps/desktop/src/renderer/domains/conversation/hooks/useModelSelectorModel.ts`（123 行）
**本仓** 同路径（230 行）

上游最终形态的骨架（`:44-123`），本仓可直接照抄其结构：

```ts
// 上游 useModelSelectorModel.ts:44-123（省略未改动的类型定义）
export function useModelSelectorModel({ updateActiveSession = true, scope }: {...}): ModelSelectorModel {
	const [globalSelectedModel, setSelectedModel] = useAtom(selectedModelAtom);
	const [reasoningByModel, setReasoningByModel] = useAtom(reasoningByModelAtom);
	const selectedModel = scope ? scope.modelKey : globalSelectedModel;
	const activeSession = useAtomValue(activeSessionAtom);
	const setModelSupportsImages = useSetAtom(modelSupportsImagesAtom);

	const handleModelSelect = useCallback(
		(key: string | null, option: ModelOption | null) => {
			if (!key) return;
			if (scope) scope.onModelSelect(key, resolveReasoning(option)?.default);
			// 用户手动选择的就是“上次使用的模型”，无论在哪个输入框选的都记为全局新会话偏好；
			// 否则 scoped 选择不落全局，刷新后普通输入框会回到一个早已不可用的旧模型。
			// 已有会话另写 session settings。
			setSelectedModel(key);
			persistSelectedModel(key);
			if (!scope && updateActiveSession && activeSession?.runtimeId) {
				void window.vetta.session.updateSettings(activeSession.runtimeId, { modelKey: key });
			}
		},
		[setSelectedModel, activeSession, updateActiveSession, scope],
	);

	const handleReasoningSelect = useCallback((value: string) => { /* …见上文… */ }, [...]);
	const rememberedLevel = selectedModel ? (scope ? scope.reasoning : reasoningByModel[selectedModel]) : undefined;
	const reasoning = useMemo(() => ({ value: rememberedLevel, onChange: handleReasoningSelect }), [rememberedLevel, handleReasoningSelect]);

	const picker = useModelPickerModel({ value: selectedModel, onChange: handleModelSelect, reasoning });
	const { options, globalDefaultKey, catalogOption, resolvedReasoning } = picker;

	// 三个 effect：自动补默认模型 / 同步图片能力 / 记忆默认档位（原文见上游 :97-120）

	return { empty: picker.empty, viewProps: picker.viewProps };
}
```

**本仓改写点**（逐条）：

1. `window.vetta.session.updateSettings` → `window.astravia.session.updateSettings`（本仓现文
   `:148` 已经是 `astravia`，保持）。
2. `isValidLevel` 局部函数删除，改用 `isValidReasoningLevel`（从 `useModelPickerModel` 导入）。
3. `t` / `fmtMultiplier` / `levelLabel` / `multiplierLabelFor` / `labels` / `groups` /
   `menuLevels` / `currentLevel` / `fallbackOptionFromKey` / `handleOpenChange`
   （本仓 `:63`、`:71-105`、`:158-172`、`:186-229`）**全部删除** —— 都已进 hook。
   删除后本文件从 230 行降到 ≈110 行，`viewProps` 直接来自 `picker.viewProps`。
4. `ModelSelectorModel` 与 `ModelSelectorScope` 两个类型保持不变（消费方依赖）：
   `ModelSelectorModel` 在 `domains/conversation/components/ModelSelector.tsx:16` 用到，
   `ModelSelectorScope` 在 `connectors/team/TeamModelSelector.tsx`、`agent-teams` 用到。

### 2.6 `TeamMemberModelSelector.tsx`（122 → 42 行）

**上游** `apps/desktop/src/renderer/domains/agent-teams/components/TeamMemberModelSelector.tsx`（42 行，全文）：

```tsx
import { ModelSelect } from "@shared/components/ModelSelect";
import type { JSX } from "react";

export interface TeamMemberModelSelectorProps {
	readonly value: string | null;
	readonly reasoning?: string;
	readonly disabled?: boolean;
	readonly placeholder: string;
	readonly emptyLabel: string;
	readonly ariaLabel: string;
	readonly onChange: (value: string | null) => void;
	readonly onReasoningChange: (reasoning: string) => void;
}

/**
 * 团队成员模型。成员模型允许空值（跟随会话），所以不用会自动补默认值、并写入全局最近模型的
 * 输入栏选择器，而用同源的受控 ModelSelect。
 */
export function TeamMemberModelSelector({ /* …同 props… */ }: TeamMemberModelSelectorProps): JSX.Element {
	return (
		<ModelSelect
			value={value}
			onChange={onChange}
			allowClear
			clearLabel={emptyLabel}
			ariaLabel={ariaLabel}
			disabled={disabled}
			placeholder={placeholder}
			triggerClassName="w-full"
			reasoning={{ value: reasoning, onChange: onReasoningChange }}
		/>
	);
}
```

**本仓** 同路径（122 行），改造 = 整份替换为上面这份（包名无差异，`@shared/components/ModelSelect`
两边一致）。**删掉的本地实现**：`labels` 手工拼装（`:52-75`）、`groups` 拼装（`:85-90`）、
`ModelSelectorView` 的 15 个 props（`:78-100`）、`fallbackOptionFromKey`（`:104-112`）、
`reasoningLevels`（`:114-118`）、`isValidReasoning`（`:120-122`）、以及
`modelCatalog` / `resolveReasoning` / `useModelOptions` / `ModelSelectorLabels` /
`ModelSelectorOptionView` / `fmtMultiplier` / `useTranslation` 七个导入。

**注意保持不变的东西**：`ModelSelectorView` 上原先由本组件传入的 `className`
（`:94`：`w-full max-w-none justify-between rounded-md border border-input …`）在改造后由
`triggerClassName="w-full"` + `variant="field"`（`ModelSelect` 默认值）代替。`variant` 默认
`field` 的皮肤已与设置页下拉同源（`SELECT_TRIGGER_CLASS`），视觉上比原来的手写类更一致；
如果产品要求保留原边框形态，改用 `triggerClassName="w-full"` 即可，不要传 `variant`。

### 2.7 五个 `ModelSelect` 调用点：props 映射

改造后这些调用点的 props **不需要改**（`ModelSelectProps` 保持超集），但有两处需要复核：

| 调用点 | 现用 props | 复核要点 |
| --- | --- | --- |
| `settings/components/ModelsDefaultModelSection.tsx:42-49` | `value` `onChange` `allowClear` `reasoning` `clearLabel` `ariaLabel` | 无 `triggerClassName` → 用 `field` 默认皮肤；`allowClear` 的 `clearLabel` 继续生效 |
| `settings/components/KnowledgeBaseSettingsView.tsx:82-92` | + `disabled` `placeholder` `triggerClassName`（含 `border-amber-500/50` 未选告警） | `triggerClassName` 会与 `VARIANT_CLASS.field` 叠加；`border-amber-500/50` 能否压过 `SELECT_TRIGGER_CLASS` 的 `border-transparent` 需实测（两者都是 `border-*`，Tailwind 后者胜出取决于生成顺序）。必要时把告警色改成 `ring` |
| `settings/components/ImBridgeSettingsView.tsx:166-180` | `allowClear` `disabled` `placeholder` `triggerClassName`（`h-8 min-w-[220px] … bg-card`） | 无 `reasoning`；`onChange` 自己拆 `provider/model`（`:168-176`）保持不变 |
| `scheduler/components/SchedulerTaskFieldsView.tsx:105-119` | `allowClear` `autoSelectDefault={false}` `placeholder` `onChange` | `autoSelectDefault` 显式关掉，改造后仍生效（hook 里判断）；**不要**误传 `defaultKey` |
| `batch-tasks/components/batch-project-form/BatchProjectRuntimeFields.tsx:43-48` | `value` `onChange` `placeholder` `triggerClassName` | 无 `allowClear`：选过就不能清空（与现状一致） |

### 2.8 步骤 1 的最小验证口径

1. `bun run check:quick -- <改动文件列表>`（lint + 架构守卫）。
2. 定向测试：
   - `bun run test:impact -- apps/desktop/src/renderer/shared/components/ModelSelect/ModelSelect.tsx apps/desktop/src/renderer/domains/conversation/hooks/useModelSelectorModel.ts`
   - 现有相关用例（改造后必须仍绿）：
     - `apps/desktop/src/renderer/domains/conversation/components/ModelSelectorView.test.tsx`
     - `apps/desktop/src/renderer/shared/components/model-selector-menu-panel.test.tsx`
     - `apps/desktop/src/renderer/domains/settings/components/ModelsDefaultModelSection.test.tsx`
       （**注意**：该用例 `:17-19` 把 `@shared/components/ModelSelect` 整个 mock 成两个按钮，
       改造后仍能通过，但**证明不了**选择器真的接上了；本步骤要补一条不 mock 的
       `ModelSelect` 组件用例，见下）
     - `apps/desktop/src/renderer/domains/settings/components/ModelsSettingsView.test.tsx`
     - `apps/desktop/src/renderer/domains/settings/components/ImBridgeSettingsView.test.tsx`
3. 新增用例（本步骤的"用户常见路径"证据）：`apps/desktop/src/renderer/shared/components/ModelSelect/ModelSelect.test.tsx`
   —— 打开触发器 → 面板出现 → 点某个模型 → `onChange` 收到 `provider/modelId`；
   `allowClear` 时点「未设置」→ `onChange(null)`。因为本仓容器是 **Popover 不是 menu**（D1），
   查询要用 `getByRole("button", { name: ariaLabel })` 打开后按文本找模型行，
   **不要**写 `getByRole("menuitem")`。
4. 视觉/主题回归：`packages/theme-ui` 的 `verify-purity` 脚本（`bun run --cwd packages/theme-ui verify:purity`
    或仓库既有入口）需通过；`chat.modelSelectorView` 覆盖点接入后（本仓是新增）设置页外观无意外变化。

---

## 3. 步骤 2：pan7 宿主 `ModelPicker` + r81i `menuClassName`

### 3.1 `plugin-sdk/src/model-picker.ts`（新建，可逐字照搬）

**上游** `packages/plugins/plugin-sdk/src/model-picker.ts`（55 行，全文）：

```ts
import { createElement, type ReactElement } from "react";
import { requireBridge } from "./host-bridge.js";

// ─── Model picker (host-rendered) ───
//
// 插件里选模型用的就是宿主输入栏右下角那一个：数据（本地配置 + 登录后的远程目录）、
// 服务商分栏、收藏、搜索、模型详情、推理档位与主题定制全部由宿主提供并保持同步。
// 插件只给受控的 value / onChange，决定选中的 modelKey 写到哪。

/** 推理档位的受控值。提供后选择器出现「推理档位」一栏。 */
export interface PluginModelPickerReasoning {
	/** 当前档位；无效或缺省时按所选模型的默认档位显示。 */
	value: string | undefined;
	onChange(level: string): void;
}

export interface PluginModelPickerProps {
	/** 当前选中的 `provider/modelId`；null 表示未选。 */
	value: string | null;
	/** 选中回调。只有提供了 `emptyOption` 时才会收到 null。 */
	onChange(modelKey: string | null): void;
	/** 推理档位；不传就没有这一栏，选中模型后菜单立即关闭。 */
	reasoning?: PluginModelPickerReasoning;
	/** 列表顶部的空值项，如「跟随默认」；选中它回调 null。 */
	emptyOption?: { label: string };
	/** 未选中时触发器上的文案；缺省为宿主的「选择模型」。 */
	placeholder?: string;
	/** 打「默认」徽章的模型；缺省为用户在宿主里设置的默认模型。 */
	defaultModelKey?: string;
	/** 未选中时自动选上宿主默认模型（只回调一次 onChange）。 */
	autoSelectDefault?: boolean;
	disabled?: boolean;
	ariaLabel?: string;
	/**
	 * 触发器形态：`field`（默认）为表单里带边框的选择框；`inline` 为输入栏里的无边框小胶囊。
	 */
	variant?: "field" | "inline";
	/** 追加到触发器上的类名（尺寸、圆角等）。 */
	className?: string;
	/**
	 * 追加到弹出菜单上的类名。菜单挂在 body 上、默认 `z-50`；选择器放在层级更高的浮层里
	 * （如画布上 `z-[100]` 的节点编辑器）时，用它把菜单抬到浮层之上。
	 */
	menuClassName?: string;
}

/**
 * 宿主模型选择器。与会话输入栏、知识库设置等处是同一个组件、同一份模型目录。
 *
 * 选出来的 modelKey 可直接交给 `ctx.ai.complete({ modelKey })`、
 * `ctx.official.sessions.create({ modelKey })` 等；能否真正调用仍由对应能力的权限决定。
 * 没有可选模型且未选中、也没有 `emptyOption` 时不渲染任何内容。
 */
export function ModelPicker(props: PluginModelPickerProps): ReactElement {
	return createElement(requireBridge().ModelPicker, props);
}
```

**可直接照搬**：整份。文件里没有品牌名，无需替换。唯一外部依赖是 `./host-bridge.js`
的 `requireBridge()` —— 本仓已有（`packages/plugins/plugin-sdk/src/host-bridge.ts:29-35`，
报错文案 `"Astravia plugin host bridge is not installed"` 与上游同构）。

### 3.2 `host-bridge.ts` 新增字段

**上游** `packages/plugins/plugin-sdk/src/host-bridge.ts:1-26`：

```ts
import type { ComponentType } from "react";
import type { ConversationMessage, ConversationState, PluginConversationApi } from "./conversation.js";
import type { PluginModelPickerProps } from "./model-picker.js";
import type { PluginPromptAttachment } from "./prompt-attachment.js";
import type { PluginSidebarState } from "./ui.js";

export interface PluginHostBridge {
	useActiveConversation(): ConversationState;
	useConversationMessages(): ConversationMessage[];
	usePromptAttachment(): PluginPromptAttachment | null;
	useLocale(): string;
	useSidebarState(): PluginSidebarState;
	/** 宿主的模型选择器（与会话输入栏同一个），由 {@link ModelPicker} 渲染。 */
	ModelPicker: ComponentType<PluginModelPickerProps>;
	conversation: PluginConversationApi;
}
```

**本仓** 同路径（`host-bridge.ts:12-23`）：加 `import type { ComponentType } from "react";`、
`import type { PluginModelPickerProps } from "./model-picker.js";`，在
`useSidebarState(): PluginSidebarState;` 之后加字段 + 注释。其余不动。

### 3.3 `index.ts` 导出

**上游** `packages/plugins/plugin-sdk/src/index.ts:447-450`（文件尾）：

```ts
// Host-rendered model picker (same component as the chat input bar)
export type { PluginModelPickerProps, PluginModelPickerReasoning } from "./model-picker.js";
export { ModelPicker } from "./model-picker.js";
```

**本仓** `packages/plugins/plugin-sdk/src/index.ts` 尾部（现有 React hooks 导出块之后）追加同三行。
注意本仓该文件已有 `export { … useSidebarState } from "./hooks.js";` 结尾，追加在其后即可。

### 3.4 `PluginModelPicker.tsx`（新建，可逐字照搬）

**上游** `apps/desktop/src/renderer/domains/plugins/runtime/PluginModelPicker.tsx`（40 行，全文）：

```tsx
import { ModelSelect } from "@shared/components/ModelSelect";
import type { PluginModelPickerProps } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";

/**
 * 经 host bridge 交给插件的模型选择器（plugin-sdk 的 `ModelPicker`）。
 *
 * 就是宿主自己用的 ModelSelect：同一份目录、同一个视图、同一份收藏，插件只决定选中值写到哪。
 * 这里只做插件合同到宿主 props 的映射，别在这里长出插件专属的行为。
 */
export function PluginModelPicker({
	value,
	onChange,
	reasoning,
	emptyOption,
	placeholder,
	defaultModelKey,
	autoSelectDefault,
	disabled,
	ariaLabel,
	variant,
	className,
	menuClassName,
}: PluginModelPickerProps): JSX.Element {
	return (
		<ModelSelect
			value={value}
			onChange={onChange}
			reasoning={reasoning}
			allowClear={emptyOption !== undefined}
			clearLabel={emptyOption?.label}
			placeholder={placeholder}
			defaultKey={defaultModelKey}
			autoSelectDefault={autoSelectDefault}
			disabled={disabled}
			ariaLabel={ariaLabel}
			variant={variant}
			triggerClassName={className}
			menuClassName={menuClassName}
		/>
	);
}
```

**本仓改写点**：`@vetta-org/plugin-sdk` → `@astravia-org/plugin-sdk`。其余逐字。
注释里的「同一份收藏」在本仓成立（收藏在视图内部，`ModelSelect` 也走同一个视图），无需改。

### 3.5 宿主 bridge 装配

**上游** `apps/desktop/src/renderer/domains/plugins/runtime/plugin-host-bridge.ts`：

```ts
// 上游 :46 新增导入
import { PluginModelPicker } from "./PluginModelPicker";

// 上游 :834-838（bridge 对象）
export const pluginHostBridge: PluginHostBridge = {
	useActiveConversation,
	useConversationMessages,
	usePromptAttachment,
	useLocale,
	useSidebarState,
	ModelPicker: PluginModelPicker,
	conversation,
};
```

**本仓** `apps/desktop/src/renderer/domains/plugins/runtime/plugin-host-bridge.ts:829-836`（bridge 对象）
—— 同样加一行 `ModelPicker: PluginModelPicker,` 与导入。

**不要顺手改这个文件里的 `useActiveConversation`**：那是 3cnb 的范围
（见 evidence 报告 §2.1），两个改动可以在同一批次提交但分开验证。

### 3.6 主进程 `plugin-protocol.ts` 透传

**上游** `apps/desktop/src/main/plugins/plugin-protocol.ts:132` 之前一行：

```ts
export const usePluginShortcutScope = sdk.usePluginShortcutScope;
export const ModelPicker = sdk.ModelPicker;
```

**本仓** `apps/desktop/src/main/plugins/plugin-protocol.ts:131`（`export const usePluginShortcutScope = sdk.usePluginShortcutScope;`）
之后加同一条。位置在给插件注入的 sdk 导出清单里（该块以 `\`);` 结束，见 `:132`）。

**为什么必须有**：插件 bundle 通过宿主注入的 sdk 门面拿 `ModelPicker`；缺这一行，
插件侧 `import { ModelPicker } from "@astravia-org/plugin-sdk"` 在运行时是 `undefined`，
表现为「插件加载后选择器区域空白」，且构建与类型检查都不会报错。

### 3.7 r81i：`menuClassName` 落点（逐字确认）

上游 `5a0fce85a` 的落点在 **`classNames.content`**，不是 `trigger`：

```tsx
// 上游 ModelSelect.tsx:88-91（改造后）
		<ThemedModelSelectorView
			{...model.viewProps}
			ariaLabel={ariaLabel}
			disabled={disabled}
			triggerVariant={variant}
			classNames={{ trigger: triggerClassName, content: menuClassName }}
		/>
```

即：`triggerClassName → classNames.trigger`，`menuClassName → classNames.content`。
`PluginModelPicker` 侧对应为：

```tsx
			variant={variant}
			triggerClassName={className}
			menuClassName={menuClassName}
```

**本仓注意**：本仓 `ModelSelectorView` 把 `classNames.content` 并入 **PopoverContent**
（`ModelSelectorView.tsx:288-296` 的 `className={cn("w-[min(34rem,…)] … ", classNames?.content)}`），
而 `className` 并入 **触发器**（`:274` `className={cn(className, classNames?.trigger)}`）。
所以：
- 插件的 `menuClassName="z-[110]"` 会落在 Popover 内容上 —— 语义正确（抬高层级）。
- 插件的 `className` 必须走 `triggerClassName`（`PluginModelPicker` 已这么映射），
  **不要**映射到视图的 `className`，否则会与 `classNames.trigger` 双重叠加。

### 3.8 版本与 CHANGELOG 写法

上游 `e4042b282`：

- `packages/plugins/plugin-sdk/package.json`：`"version": "0.3.11"` → `"0.3.12"`。
- `packages/plugins/plugin-sdk/CHANGELOG.md`：把 `[Unreleased]` 改成 `## [0.3.12] — 2026-11-12`，
  条目文本（上游原文，需含 `menuClassName`，因为 r81i 先于定版）：

> 新增 `ModelPicker` 组件：宿主渲染的模型选择器，与会话输入栏右下角、知识库设置等处是同一个组件、同一份模型清单（含登录后的云端目录、收藏、推理档位与主题定制）。插件只传受控的 `value` / `onChange`，可选 `reasoning`、`emptyOption`、`defaultModelKey`、`autoSelectDefault`、`variant`、`menuClassName`（选择器放在层级更高的浮层里时抬高菜单）。不需要权限，也不需要 `hostThemeUi`；此前插件只能自己调 `official.models.list()` / `ctx.ai.listModels()` 再拼 `ModelSelectorView` 或原生 `<select>`，字段不全且不会随宿主目录更新。需要 Desktop 0.5.76+，`PluginHostBridge` 相应新增 `ModelPicker`。

- `bun.lock` 里 plugin-sdk 的版本号同步（上游 `e4042b282` 改了 `bun.lock` 的 workspace 条目版本）。

**本仓必须一起处理的两件事**（上游当期没有，本仓有）：

1. 本仓 `plugin-sdk` 仍是 `0.3.11`，但 `CHANGELOG.md:5-7` 的 `[Unreleased]` 里已经写着
   `registerHeaderAction`（要求 Plugin API `^2.9.0`）。定版时要**同时**给这两条，
   即 `0.3.12` 节里既有 `registerHeaderAction` 又有 `ModelPicker`；或者本仓按自己的节奏
   出 `0.3.12`（ModelPicker）与 `0.3.13`（顶栏动作定版）两档，与上游编号对齐。二选一，
   但不能只写 ModelPicker 而让顶栏动作继续挂在 Unreleased 里。
2. 本仓 `open-in-app` 插件已声明 `pluginApiVersion: "^2.9.0"`，其 SDK 依赖也指向 workspace；
   版本推进后要重新 `bun install`，并确认 `bun.lock` 与新插件目录的 workspace 条目都在。

### 3.9 插件文档（随 pan7 一起，不能留到后面）

上游在同提交改了两处，本仓对应文件都在：

| 上游 | 本仓 | 内容 |
| --- | --- | --- |
| `docs/plugin/ai.md` 新增「让用户选模型：`ModelPicker`」整节（含 props 表与示例） | `docs/plugin/ai.md` | 把「两项权限独立」那句改成上游措辞：需要自己拿清单才声明 `ai.models.list`，只是让用户挑一个模型就用 `ModelPicker` |
| `docs/plugin/styling-and-pitfalls.md` 在 `plugin-ui` 一节加一段「只是要让用户选一个模型时，不要用 `ModelSelectorView` 自己拼数据」 | 同路径 | 语序照搬，链接指向 `ai.md#让用户选模型modelpicker` |

上游那段原文（可直接用）：

> 只是要让用户选一个模型时，不要用这里的 `ModelSelectorView` 自己拼数据，直接用
> `@vetta-org/plugin-sdk` 的 `ModelPicker`（见 [ai](./ai.md#让用户选模型modelpicker)）：
> 数据和行为都由宿主提供，与输入栏的模型选择器完全一致，也不需要开启 `hostThemeUi`。
> `ModelSelectorView` 只留给需要完全自定义清单的场景。

### 3.10 步骤 2 的最小验证口径

1. `bun run check:quick -- packages/plugins/plugin-sdk/src/model-picker.ts packages/plugins/plugin-sdk/src/host-bridge.ts packages/plugins/plugin-sdk/src/index.ts apps/desktop/src/renderer/domains/plugins/runtime/PluginModelPicker.tsx apps/desktop/src/renderer/domains/plugins/runtime/plugin-host-bridge.ts apps/desktop/src/main/plugins/plugin-protocol.ts`
2. 新增 `apps/desktop/src/renderer/domains/plugins/runtime/PluginModelPicker.test.tsx`，
   照上游 `PluginModelPicker.test.tsx` 的两条断言改写（**必须改的部分**见 D1）：
   - 映射：`value=null` + `emptyOption` + `placeholder` + `defaultModelKey` + `ariaLabel` + `className` + `menuClassName`
     → 触发器文本是 `placeholder`、`trigger.className` 含传入类名、菜单容器含 `menuClassName`、
     点模型回调 `acme/fast`、点空值项回调 `null`。
   - 推理：传 `reasoning` 时档位出现在面板里，点击回调 `onLevel("low")`。
   - 上游用 `screen.getByRole("menu")` 取菜单容器；**本仓要改成** Popover 的
     `getByRole("dialog")`（Radix Popover 默认 `role="dialog"`），或直接按
     `[data-radix-popper-content-wrapper]` 定位。先跑一次确认实际 role 再写断言。
   - 需要 stub：`ResizeObserver`、`HTMLElement.prototype.scrollIntoView`（上游同款），
     mock `@shared/store/model-catalog` 与 `@shared/components/ModelSelect/useModelOptions`。
3. SDK 单测：新增 `packages/plugins/plugin-sdk/test/model-picker.test.ts`（上游有 36 行）：
   `__setPluginHostBridge` 注入桩 → `ModelPicker` 渲染出桩组件并透传 props；
   未注入 bridge 时抛 `Astravia plugin host bridge is not installed`。
4. 契约层：`packages/plugins/plugin-sdk` 若有 manifest/permissions 合同测试，确认新导出不影响
   清单校验（`ModelPicker` 不需要权限，`pluginApiVersion` 不变）。

---

## 4. 步骤 3：三个插件迁移

### 4.1 content-creation（`cc2d14711`）

**上游改动清单**

| 动作 | 上游路径 | 本仓路径 | 判定 |
| --- | --- | --- | --- |
| 删除 | `src/prompt-optimization/usePromptOptimizationModels.ts`（59 行） | 同路径存在，同规模 | 直接删 |
| 新增 | `src/prompt-optimization/usePromptOptimization.ts`（27 行，全文见下） | 同路径 | 照搬 |
| 改写 | `src/prompt-optimization/PromptOptimizationControl.tsx`（改 import 与 JSX） | 同路径（`PromptOptimizationControl.tsx:1-16`、`:52-75`） | 照搬 + 保留本仓 i18n key |
| 改写 | `src/node/ContentPromptEditor.tsx`（解构少三项） | 同路径 `:6`（导入）、`:45-57`（解构）、`:188-193`（`optimization={{ … }}`） | 照搬 |
| 删方法 | `src/prompt-optimization/prompt-optimization-service.ts` 的 `listModels()` + `PluginAiModelListResult` 导入 | 同路径 `:2-3`（`PluginAiModelListResult` 导入）、`:30`（`modelListPromise` 字段）、`:34-41`（`listModels`） | 照搬 |
| 权限 | `plugin.json` 删 `"ai.models.list"` | `plugin.json:26` | 照搬 |
| i18n | 删 `nodeEditor.promptOptimization.loadingModels`、`error.promptOptimizationModels`（中英） | `locales/{zh,en}.json` | 照搬 |
| 测试 | `test/node-editor-interaction.dom.test.tsx` 的 mock 从 `usePromptOptimizationModels` 换成 `usePromptOptimization` | 同路径 `:47-53` | 照搬 |

**新增文件全文（照搬，仅包名无关）**：

```ts
import { useState } from "react";
import { useContentCreationRuntime } from "../plugin/runtime-context";
import type { ContentPromptOptimizationService } from "./prompt-optimization-service";

interface PromptOptimizationState {
	/** 选中的提示词优化模型；未选时由宿主的模型选择器补上用户的默认模型。 */
	selectedModelKey?: string;
	setSelectedModelKey: (modelKey: string) => void;
	optimizePrompt: ContentPromptOptimizationService["optimize"];
	reportError: (message: string, error: unknown) => void;
}

/**
 * 提示词优化的状态。可选模型由宿主的 ModelPicker 提供（与输入栏同一份清单），
 * 这里只记住当前选中的那一个，初值取节点上次优化时用的模型。
 */
export function usePromptOptimization(preferredModelKey?: string): PromptOptimizationState {
	const runtime = useContentCreationRuntime();
	const [selectedModelKey, setSelectedModelKey] = useState<string | undefined>(preferredModelKey);

	return {
		selectedModelKey,
		setSelectedModelKey,
		optimizePrompt: (request) => runtime.promptOptimization.optimize(request),
		reportError: (message, error) => runtime.notifyError(message, error),
	};
}
```

**`PromptOptimizationControl` 的核心替换（上游原文）**：

```tsx
import { ModelPicker, useTranslation } from "@astravia-org/plugin-sdk";
// …
				{/* 宿主的模型选择器，与会话输入栏同一份清单；未选时自动带上用户的默认模型。 */}
				<ModelPicker
					value={selectedModelKey ?? null}
					onChange={(modelKey) => {
						if (modelKey) onModelChange(modelKey);
					}}
					autoSelectDefault
					placeholder={t("nodeEditor.promptOptimization.model")}
					ariaLabel={t("nodeEditor.promptOptimization.model")}
					className="w-full"
					menuClassName="z-[110]"
				/>
```

`PromptOptimizationControlProps` 从 8 个字段减到 6 个（删 `models`、`isLoadingModels`）。

**本仓改写点**：本仓 `PromptOptimizationControl` 的 props 与上游现状一致（已核对
`PromptOptimizationControl.tsx:9-18`），只是 `models`/`isLoadingModels` 仍在，按上游删掉即可。
另需确认 `ContentPromptEditor` 里 `optimization={{ … }}` 的对象（`:181-190`）同步删两项，
否则类型检查会报多余属性。

**本仓额外注意**：本仓 `prompt-optimization-service.ts` 的 `listModels()` 有并发缓存
（`modelListPromise`）。删除后 `ContentPromptOptimizationService` 只剩 `optimize`；
`runtime.promptOptimization` 的类型若以该 service 派生，`usePromptOptimization` 里
`ContentPromptOptimizationService["optimize"]` 仍可用。

### 4.2 chinese-chess（`05df907dd`）

**上游改动清单**

| 动作 | 上游路径 | 本仓路径 | 判定 |
| --- | --- | --- | --- |
| 删除 | `src/components/ModelPicker.tsx`（45 行，原生 `<select>`） | 同路径（本仓 `:1-45`） | 直接删 |
| 改写 | `src/components/NewGameScreen.tsx`（`:78-91`） | 同路径 `:82`（`<ModelPicker value={modelKey} onChange={setModelKey} />`） | 照搬 |
| 改写 | `src/components/SidePanel.tsx`（`:234-247`） | 同路径 `:238`（`<ModelPicker value={snap.modelKey} onChange={props.onModelChange} />`） | 照搬 |
| 收窄 | `src/host.ts`：`createChessRuntime` 去掉 `listModels` | 本仓 `:10-29`（`listModels` 在 `:20-28`） | 照搬，返回 `{ store }` |
| 收窄 | `src/runtime-context.tsx`：`ChessRuntime` 去掉 `listModels` 与 `PluginAiModelListResult` 导入 | 本仓 `:1`（导入）、`:12-13`（字段与注释） | 照搬 |
| 权限 | `plugin.json` 删 `"ai.models.list"` | 本仓 `plugin.json:19` | 照搬 |
| 测试 | `test/activate-lifecycle.dom.test.tsx` 的 sdk mock 加 `ModelPicker: () => null` | 同路径 | 照搬 |
| 测试 | `test/chess-view.dom.test.tsx` 里对原生 select 的断言改写 | 同路径 | 需按本仓现状核对 |

**两处调用点的最终形态（上游原文，注意哨兵映射）**：

```tsx
// NewGameScreen.tsx —— 通过 emptyOption 表达「跟随默认」，不再用 value="" 的原生 option
<ModelPicker
	value={modelKey}
	onChange={setModelKey}
	emptyOption={{ label: t("newGame.model.default") }}
	placeholder={t("newGame.model.default")}
	ariaLabel={t("model.label")}
	className="max-w-44"
/>
```

```tsx
// SidePanel.tsx —— 同上，onChange 直接透传（上游 props.onModelChange 已接受 string | null）
<ModelPicker
	value={snap.modelKey}
	onChange={props.onModelChange}
	emptyOption={{ label: t("newGame.model.default") }}
	placeholder={t("newGame.model.default")}
	ariaLabel={t("model.label")}
	className="max-w-44"
/>
```

**哨兵值映射规则（三个插件通用）**：

| 旧实现 | 新实现 |
| --- | --- |
| 原生 `<option value="">` 表示「默认」 | `emptyOption={{ label }}`，选中回调 `null` |
| 旧组件的 `value: string \| null`（null = 默认） | 直接传 `value`，`onChange` 收到的 `null` 就是「默认」 |
| 旧组件的 `value: string`（空串 = 默认） | `value={x || null}`，`onChange={(k) => setX(k ?? "")}` |
| 旧组件自造哨兵（如 kanban `__kanban_inherit__`） | 删掉哨兵，改用 `emptyOption` |

本仓库象棋是**外置插件**（`packages/plugins/externals/`），迁移后要在宿主里实机加载一次
（它走 `externals` 的独立打包链路，与 presets 不同）。

### 4.3 kanban（`efa5addf4`）

**上游改动清单**

| 动作 | 上游路径 | 本仓路径 | 判定 |
| --- | --- | --- | --- |
| 删除 | `src/components/ModelPicker.tsx`（118 行，自拼 `ModelSelectorView`） | 同路径 | 直接删（含 `INHERIT_KEY` 哨兵） |
| 改写 | `src/components/CardEditorDialog.tsx` | 本仓 `:211-224` | 照搬 |
| 改写 | `src/components/Composer.tsx` | 本仓 `:161-175` | 照搬 |
| 依赖 | `package.json` 删 `@vetta-org/theme-ui` | 本仓 `package.json` devDependencies 的 `@astravia-org/theme-ui` | 照搬 |
| 构建 | `vite.config.ts` 删 `hostThemeUi: true` | 本仓 `vite.config.ts`（需核对是否已开） | 照搬 |
| i18n | 删 `model.*` 九条（中英） | 本仓 `locales/{zh,en}.json` | 照搬 |
| lock | `bun.lock` 删 kanban 的 theme-ui 与 `@iconify-json/solar` 传递条目 | 本仓 `bun.lock` | `bun install` 后核对 |

**两处调用点最终形态（上游原文）**：

```tsx
// CardEditorDialog.tsx —— 先算好 inheritLabel，再传给 emptyOption 与 placeholder
const inheritLabel = boardDefaultModel
	? t("editor.modelDefaultNamed", { name: boardDefaultModel.displayName })
	: t("editor.modelDefault");
// …
<ModelPicker
	value={draft.modelKey || null}
	onChange={(modelKey) => setDraft((prev) => ({ ...prev, modelKey: modelKey ?? "" }))}
	emptyOption={{ label: inheritLabel }}
	placeholder={inheritLabel}
	defaultModelKey={defaultModelKey || undefined}
	ariaLabel={t("editor.model")}
	className="h-[34px] w-full rounded-lg border-border bg-background px-2.5"
/>
```

```tsx
// Composer.tsx —— 外层 {models.length > 0 && ( … )} 保留（看板没模型时不显示选择器）
const inheritLabel = hostDefaultModel
	? t("composer.followHostModel", { name: hostDefaultModel.displayName })
	: t("composer.defaultModel");
// …
<ModelPicker
	value={modelKey || null}
	onChange={(key) => onModelKeyChange(key ?? "")}
	emptyOption={{ label: inheritLabel }}
	placeholder={inheritLabel}
	defaultModelKey={hostDefaultModelKey || undefined}
	ariaLabel={t("composer.model")}
	className="h-6 max-w-44 rounded-full border-border/60 px-2 text-[11px] text-muted-foreground hover:border-border hover:text-foreground"
/>
```

**`value` / `onChange` 的空值语义**（kanban 是唯一需要转换的）：

- `KanbanCard.modelKey` / 看板默认模型用**空串**表示「跟随默认」，SDK 合同用 `null`。
  所以进出都要转换：`value={draft.modelKey || null}`、`onChange={(k) => …(k ?? "")}`。
- 上游把 `triggerClassName` 改名为 `className`，并在 CardEditor 的类名里**删掉了**
  `max-w-none justify-start`（那两项是旧自拼组件的产物）；Composer 的类名换成 `text-[11px]`。
  这两处类名直接照搬即可，但要在宿主里目视确认高度与圆角（`h-6` / `h-[34px]` 是看板自定义尺寸）。

**本仓额外注意（可能出现类型错误）**：本仓 kanban 现在传给 `ModelSelectorView` 的 `labels`
**缺少** `favoritesHeader` / `favorite` / `unfavorite` / `searchResultsHeader`
（本仓这四个字段在 `ModelSelectorLabels` 里是必填，见 `ModelSelectorView.tsx:47-62`）。
迁移到 `ModelPicker` 后这个不一致自然消失；如果本批次之前有人跑过 kanban 的 `bun run check`，
那里可能已有既存报错，不要把它当成新引入的回归。

### 4.4 三个插件的最小验证口径

| 插件 | 命令 | 断言要点 |
| --- | --- | --- |
| content-creation | `bun run --cwd packages/plugins/presets/content-creation test`（或仓库统一 vitest 入口） | `node-editor-interaction.dom.test.tsx` 仍绿；新增/改写一条：打开提示词优化 popover → 宿主选择器出现 → 选模型后 `promptOptimization.optimize` 收到该 `modelKey` |
| chinese-chess | 同上（externals 包） | `chess-view.dom.test.tsx` 不再断言原生 `select`；开局页与侧栏都能打开宿主选择器并选/清空 |
| kanban | `bun run --cwd packages/plugins/externals/kanban check` + `test` | `draft.modelKey` 空串 ↔ `null` 往返不丢语义；`Composer` 在 `models.length === 0` 时不渲染 |

三个插件都必须在宿主里实机加载一次（`externals` 走独立打包，单测通过不代表 MF 共享域正确）。
content-creation 与 kanban 迁移后**不再需要 `hostThemeUi`**（kanban），插件文档里应同步这一点
——这是 3.9 文档改动的直接理由。

---

## 5. 依赖关系与批次内顺序

```
129g ──► pan7 ──► r81i
          │
          ├──► content-creation (cc2d14711)
          ├──► chinese-chess  (05df907dd)
          └──► kanban         (efa5addf4)
```

硬依赖（违反会导致返工）：

1. **pan7 必须在 129g 之后**：`ModelPicker` 的宿主实现就是 `ModelSelect`；`ModelSelect` 若仍是
   自绘下拉，SDK 合同会把「第二套下拉」固化下来（evidence 报告 §4.1 已给出同一判断）。
2. **r81i 与 pan7 同批**：`menuClassName` 是 `PluginModelPickerProps` 的字段，先加 SDK 字段
   而没有宿主 `ModelSelect` 的 `menuClassName` 落点，会得到一个「能传但不生效」的 prop。
   上游顺序是先 `738949766`（ModelPicker）→ `5a0fce85a`（menuClassName）→ `e4042b282`（定版），
   本次合并成一批是对齐后的结果，**定版文本要按含 `menuClassName` 的版本写**。
3. **三个插件必须在 pan7 之后**：它们要 `import { ModelPicker } from "@astravia-org/plugin-sdk"`。
4. **版本推进与文档（§3.8、§3.9）不能滞后于插件迁移**：插件 `plugin.json` 的
   `pluginApiVersion` 与 SDK 版本不一致时，宿主会给出「版本不足」的加载错误。

每步的最小可验证口径（汇总）：

| 步 | 提交范围 | 最小验证 |
| --- | --- | --- |
| 1 | `useModelPickerModel.ts` 新建 + `ModelSelect` 重写 + barrel | `ModelSelect.test.tsx`（新增，打开→选→回调）+ 5 处调用点的设置页用例仍绿 |
| 2 | `ModelSelectorTrigger` variant + `ModelSelectorView` 透传 + 两处 index 导出 | 输入栏触发器外观不变（`inline` 默认）；设置页触发器变 `field` 皮肤；`theme-ui` purity 通过 |
| 3 | `useModelSelectorModel` 收敛 + `TeamMemberModelSelector` 重写 | 输入栏选模型仍写 session settings + 全局偏好；团队成员选空值仍回调 `null` |
| 4 | `plugin-sdk` 三文件 + `PluginModelPicker` + bridge + protocol | `PluginModelPicker.test.tsx` 两条；`plugin-sdk/test/model-picker.test.ts`；protocol 导出存在 |
| 5 | 版本 0.3.12/0.3.13 + CHANGELOG + `bun.lock` | `bun install` 后 lock 里 plugin-sdk 版本正确；manifest 合同测试绿 |
| 6 | 插件文档两处 | 文档链接有效；`docs/plugin/ai.md` 有 `ModelPicker` 一节 |
| 7 | content-creation | 插件测试绿 + 宿主实机：提示词优化选模型生效 |
| 8 | chinese-chess | 同上（externals 打包） |
| 9 | kanban | 同上 + 空串/`null` 往返 |

## 6. 必须保持的不变式（回归会真实失败的点）

1. **主题覆盖点（本仓属于新增，不是保留）**：本仓 `ModelSelect` 目前没有
   `useThemeComponent("chat.modelSelectorView")`（自绘 `DropdownMenu` + `ThemeSurface`）；重写后
   照上游加上它，于是设置页/审批卡/插件的选择器也会经过这个覆盖点。落地后必须实机确认
   设置页选择器外观没有因外部主题发生意外变化（尤其是自写了 `[data-state=open]` 类样式的主题）。
2. **`model.empty` 的渲染语义**：目录空、无选中值、无 `emptyOption` → 不渲染。上游 hook 里
   是 `options.length === 0 && !value && !emptyOption`，注意本仓输入栏旧语义是
   `options.length === 0 && !selectedModel`（无 `emptyOption` 项）——改成上游版本后会**多出**
   「有 `emptyOption` 但目录空时仍渲染空值项」的行为，这正是 kanban / 团队成员需要的
   （没有可用模型时仍能显示「跟随默认」并回调 `null`）。这不是回归，是必要变化。
3. **`onSelectedOptionChange` 的时序**：目录就绪后才回调，且只在 `catalogOption` 变化时。
   输入栏的图片能力标记依赖它。
4. **`emptyOption` 的 `null` 语义**：只有提供 `emptyOption` 时 `onChange` 才可能收到 `null`。
   三个插件都依赖这条做「跟随默认」。
5. **插件权限不变**：`ModelPicker` 不需要任何权限，也不需要 `hostThemeUi`。不要为了它给插件加
   `ai.models.list`（三个迁移都在删这条）。
6. **`ModelSelectorView` 的容器语义**：本仓是 Popover（ADR-0159），本批次**不改**。
   上游的 `role="menu"` 断言与 `DropdownMenu` 样式类不要带进来。
7. **`reasoning` 的「菜单保持打开」**：由视图内部按 `menuLevels.length` 判断
   （`ModelSelectorView.tsx:250-253`）；本批次不引入上游的 `reasoningModelKeys`。

## 7. 未覆盖 / 需要决策

- **`useModelOptions` 的三处差异（D5）**：本仓缺 `inputModalities` / `contextWindow` / `maxTokens`、
  缺「停用服务商过滤 + 停用默认值兜底」、`iconFor` 未 memo。本批次**只做最后一项**（memo，因为
  `useModelPickerModel` 的 `groups` 依赖它）。前两项属模型目录口径，会让选择器详情浮层多出
  上游有而本仓没有的字段，应单独评估，不要混进 B10。
- **`InlineModelPicker` / `ModelConfigurationPopover`（D4 的 ②）**：团队会话输入栏
  （`connectors/team/TeamModelSelector.tsx`）不是上游 129g 的对象，本批次不动。若后续要收敛，
  需要先决定「团队会话模型按成员切换」这一交互放在哪个组件里，属新的设计问题。
- **`ModelSelectorView` 的 `open` 受控开合**：本仓有（`:123`），上游也有；`ModelSelect` 重写后
  不传，保持内部开合。Cmd/Ctrl+P 唤起仍走 `domains/conversation/components/ModelSelector.tsx`，
  不受影响。
