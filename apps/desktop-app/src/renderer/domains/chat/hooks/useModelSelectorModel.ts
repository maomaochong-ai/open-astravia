import { resolveReasoning } from "@shared/components/ModelSelect/resolveReasoning";
import { type ModelOption, useModelOptions } from "@shared/components/ModelSelect/useModelOptions";
import {
	activeSessionAtom,
	modelSupportsImagesAtom,
	reasoningByModelAtom,
	SELECTED_MODEL_STORAGE_KEY,
	selectedModelAtom,
} from "@shared/store/atoms";
import type { ModelSelectorViewProps } from "@vetta/theme-ui/chat";
import { fmtMultiplier } from "@vetta/theme-ui/shared";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

export interface ModelSelectorModel {
	empty: boolean;
	viewProps: ModelSelectorViewProps;
}

function persistSelectedModel(key: string): void {
	try {
		localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, key);
	} catch {
		// ignore persistence errors (private mode / quota)
	}
}

/** options 尚未加载（如远程 catalog）时，用 modelKey 拼一个最小 option 供触发器展示。 */
function fallbackOptionFromKey(key: string): ModelOption {
	const slash = key.indexOf("/");
	const provider = slash > 0 ? key.slice(0, slash) : key;
	const modelId = slash > 0 ? key.slice(slash + 1) : key;
	return {
		provider,
		modelId,
		displayName: modelId,
		key,
	};
}

/**
 * Combined chat model + reasoning-level picker. The primary menu is the model list;
 * a "推理档位" entry at the top opens a hover submenu on the right to pick the level
 * (including "off" to disable thinking). Reasoning is per-model: each model remembers
 * its last-chosen level (reasoningByModelAtom) and the value rides the prompt.
 */
export function useModelSelectorModel(): ModelSelectorModel {
	const { t } = useTranslation("common");
	const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom);
	const [reasoningByModel, setReasoningByModel] = useAtom(reasoningByModelAtom);
	const activeSession = useAtomValue(activeSessionAtom);
	const setModelSupportsImages = useSetAtom(modelSupportsImagesAtom);
	const { options, grouped, defaultKey, iconFor, labelFor } = useModelOptions();

	const catalogOption = useMemo(() => options.find((m) => m.key === selectedModel) ?? null, [options, selectedModel]);
	// 有 key 但 catalog 未就绪时仍展示 modelId，避免闪「选择模型」。
	const selectedOption = useMemo(() => {
		if (catalogOption) return catalogOption;
		if (selectedModel) return fallbackOptionFromKey(selectedModel);
		return null;
	}, [catalogOption, selectedModel]);
	// 推理档位只认 catalog 中的真实配置，fallback option 不参与 resolve。
	const resolved = useMemo(() => resolveReasoning(catalogOption), [catalogOption]);

	// "off" (disable thinking) is always offered for reasoning-capable models, on top of
	// the model's configured/preset levels. When the model explicitly includes "none",
	// it replaces "off" so they never appear together in the dropdown.
	const menuLevels = useMemo(() => {
		if (!resolved) return [];
		if (resolved.levels.includes("none")) {
			return ["none", ...resolved.levels.filter((l) => l !== "none" && l !== "off")];
		}
		return ["off", ...resolved.levels.filter((l) => l !== "off")];
	}, [resolved]);
	const isValidLevel = useCallback(
		(v: string) => v === "off" || v === "none" || (resolved?.levels.includes(v) ?? false),
		[resolved],
	);

	const currentLevel = useMemo(() => {
		if (!selectedModel || !resolved) return undefined;
		const remembered = reasoningByModel[selectedModel];
		return remembered && isValidLevel(remembered) ? remembered : resolved.default;
	}, [selectedModel, resolved, reasoningByModel, isValidLevel]);

	const levelLabel = useCallback(
		(value: string) => t(`modelSelect.reasoningLevel.${value}`, { defaultValue: value }),
		[t],
	);

	// Auto-apply the configured default model when nothing is selected yet.
	useEffect(() => {
		if (!selectedModel && defaultKey) {
			setSelectedModel(defaultKey);
			persistSelectedModel(defaultKey);
		}
	}, [selectedModel, defaultKey, setSelectedModel]);

	// Keep image-support flag in sync with the resolved catalog selection only.
	useEffect(() => {
		if (options.length === 0) return;
		setModelSupportsImages(catalogOption?.supportsImage ?? false);
	}, [options.length, catalogOption, setModelSupportsImages]);

	// Persist the effective default level for the selected model when none is remembered,
	// so the prompt sender always has a value to send (per-model memory seeded with default).
	useEffect(() => {
		if (!selectedModel || !resolved) return;
		const remembered = reasoningByModel[selectedModel];
		if (!remembered || !isValidLevel(remembered)) {
			setReasoningByModel({ ...reasoningByModel, [selectedModel]: resolved.default });
		}
	}, [selectedModel, resolved, reasoningByModel, setReasoningByModel, isValidLevel]);

	const handleModelSelect = useCallback(
		(key: string) => {
			setSelectedModel(key);
			// 全局新会话偏好；已有会话另写 session settings。
			persistSelectedModel(key);
			if (activeSession?.runtimeId) {
				void window.vetta.session.updateSettings(activeSession.runtimeId, { modelKey: key });
			}
		},
		[setSelectedModel, activeSession],
	);

	/**
	 * 计费倍率标的文案。视图只负责渲染，倍率口径与「免费」措辞留在宿主——
	 * 插件复用同一个视图时不会连带继承宿主的计费文案。
	 */
	const multiplierLabelFor = useCallback(
		(option: { key: string }): string | undefined => {
			const multiplier = options.find((candidate) => candidate.key === option.key)?.multiplier;
			if (!multiplier) return undefined;
			return multiplier.input === 0 && multiplier.output === 0
				? t("modelSelect.free")
				: t("modelSelect.multiplier", { value: fmtMultiplier(multiplier.input) });
		},
		[options, t],
	);

	const handleReasoningSelect = useCallback(
		(value: string) => {
			if (!selectedModel) return;
			setReasoningByModel({ ...reasoningByModel, [selectedModel]: value });
		},
		[selectedModel, reasoningByModel, setReasoningByModel],
	);

	return {
		// 已有选中 key 时即使 options 还在加载也展示触发器，避免空白/占位闪烁。
		empty: options.length === 0 && !selectedModel,
		viewProps: {
			currentLevel,
			defaultKey,
			groups: [...grouped.entries()].map(([provider, models]) => ({
				icon: iconFor(provider),
				label: labelFor(provider),
				models,
				provider,
			})),
			labels: {
				clearSearch: t("modelSelect.clearSearch"),
				multiplierLabel: multiplierLabelFor,
				cloudOnly: t("modelSelect.cloudOnly"),
				defaultBadge: t("modelSelect.defaultBadge"),
				levelLabel,
				modelHeader: t("modelSelect.modelHeader"),
				noResults: t("modelSelect.noResults"),
				noResultsHint: t("modelSelect.noResultsHint"),
				placeholder: t("modelSelect.placeholder"),
				reasoningHeader: t("modelSelect.reasoningHeader"),
				searchPlaceholder: t("modelSelect.searchPlaceholder"),
				visionBadge: t("modelSelect.visionBadge"),
			},
			menuLevels,
			onModelSelect: handleModelSelect,
			onReasoningSelect: handleReasoningSelect,
			selectedModel: selectedModel ?? undefined,
			selectedOption,
		},
	};
}
