import type { ModelSelectorLabels, ModelSelectorViewProps } from "@astravia-org/theme-ui/chat";
import { fmtMultiplier } from "@astravia-org/theme-ui/shared/MultiplierTag";
import { modelCatalog } from "@shared/store/model-catalog";
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

/** 目录尚未加载出该 key 时，拼一个最小 option 供触发器展示。 */
export function fallbackOptionFromKey(key: string): ModelOption {
	const slash = key.indexOf("/");
	const provider = slash > 0 ? key.slice(0, slash) : key;
	const modelId = slash > 0 ? key.slice(slash + 1) : key;
	return { provider, modelId, displayName: modelId, key };
}

/**
 * 菜单里列出的档位。「关闭思考」总是提供；模型自己声明了 `none` 时由它替代 `off`，两者不同时出现。
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

/**
 * 宿主唯一的模型选择器连接层：读同一份模型目录（本地 models.json + 登录后的远程目录），
 * 拼出 ModelSelectorView 需要的分组、文案与推理档位。
 *
 * 输入栏、设置页、团队成员、插件（经 host bridge）都从这里取 props，选择器因此只有一个
 * 数据口径与一副样子；各处只决定「选中的值写到哪」。
 *
 * 收藏不在这里：收藏状态与星标 UI 都在 ModelSelectorView 内部（localStorage 键
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
	const resolved = useMemo(
		() => (hasReasoning ? resolveReasoning(catalogOption) : null),
		[hasReasoning, catalogOption],
	);
	const menuLevels = useMemo(() => reasoningMenuLevels(resolved), [resolved]);
	const rememberedLevel = reasoning?.value;
	const currentLevel = resolved
		? rememberedLevel && isValidReasoningLevel(rememberedLevel, resolved)
			? rememberedLevel
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
		() =>
			emptyLabel === undefined ? undefined : { label: emptyLabel, onSelect: () => onChangeRef.current(null, null) },
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

	// 引用保持稳定：视图里的搜索过滤与行级 memo 依赖它们不随无关状态换新。
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
			providerHeader: t("modelSelect.providerHeader"),
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
			favoritesEmpty: t("modelSelect.favoritesEmpty"),
			searchResultsHeader: t("modelSelect.searchResultsHeader"),
			// 行尾详情浮层（本仓是扁平字段）。
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
