import type { ModelSelectorViewProps } from "@astravia-org/theme-ui/chat";
import {
	isValidReasoningLevel,
	type ModelOption,
	resolveReasoning,
	useModelPickerModel,
} from "@shared/components/ModelSelect";
import {
	activeSessionAtom,
	modelSupportsImagesAtom,
	reasoningByModelAtom,
	SELECTED_MODEL_STORAGE_KEY,
	selectedModelAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";

export interface ModelSelectorModel {
	empty: boolean;
	viewProps: ModelSelectorViewProps;
}

export interface ModelSelectorScope {
	readonly modelKey: string | null;
	readonly reasoning?: string;
	readonly onModelSelect: (modelKey: string, defaultReasoning?: string) => void;
	readonly onReasoningSelect: (reasoning: string) => void;
}

export function persistSelectedModel(key: string): void {
	try {
		localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, key);
	} catch {
		// ignore persistence errors (private mode / quota)
	}
}

/**
 * 输入栏的模型 + 推理档位选择器。数据与文案全部来自 `useModelPickerModel`（与设置页、
 * 团队成员、插件用的是同一个连接层），这里只负责「选中的值写到哪」：
 * 全局新会话偏好、当前会话的 settings、以及按模型记住的档位。
 */
export function useModelSelectorModel({
	updateActiveSession = true,
	scope,
}: {
	readonly updateActiveSession?: boolean;
	readonly scope?: ModelSelectorScope;
} = {}): ModelSelectorModel {
	const [globalSelectedModel, setSelectedModel] = useAtom(selectedModelAtom);
	const [reasoningByModel, setReasoningByModel] = useAtom(reasoningByModelAtom);
	const selectedModel = scope ? scope.modelKey : globalSelectedModel;
	const activeSession = useAtomValue(activeSessionAtom);
	const setModelSupportsImages = useSetAtom(modelSupportsImagesAtom);

	const rememberedLevel = selectedModel ? (scope ? scope.reasoning : reasoningByModel[selectedModel]) : undefined;

	const handleModelSelect = useCallback(
		(key: string | null, option: ModelOption | null) => {
			if (!key) return;
			if (scope) scope.onModelSelect(key, resolveReasoning(option)?.default);
			// 用户手动选择的就是「上次使用的模型」，无论在哪个输入框选的都记为全局新会话偏好；
			// 否则 scoped 选择不落全局，刷新后普通输入框会回到一个早已不可用的旧模型。
			// 已有会话另写 session settings。
			setSelectedModel(key);
			persistSelectedModel(key);
			if (!scope && updateActiveSession && activeSession?.runtimeId) {
				void window.astravia.session.updateSettings(activeSession.runtimeId, { modelKey: key });
			}
		},
		[setSelectedModel, activeSession, updateActiveSession, scope],
	);

	const handleReasoningSelect = useCallback(
		(level: string) => {
			if (!selectedModel) return;
			if (scope) scope.onReasoningSelect(level);
			else setReasoningByModel({ ...reasoningByModel, [selectedModel]: level });
		},
		[selectedModel, reasoningByModel, setReasoningByModel, scope],
	);

	const reasoning = useMemo(
		() => ({ value: rememberedLevel, onChange: handleReasoningSelect }),
		[rememberedLevel, handleReasoningSelect],
	);

	const picker = useModelPickerModel({ value: selectedModel, onChange: handleModelSelect, reasoning });
	const { options, globalDefaultKey, catalogOption, resolvedReasoning } = picker;

	// 还没选过模型时补上配置的默认模型：scoped 输入框走 scope 回调，普通输入框直接落全局。
	useEffect(() => {
		if (selectedModel || !globalDefaultKey) return;
		if (scope) {
			const fallback = resolveReasoning(options.find((option) => option.key === globalDefaultKey) ?? null);
			scope.onModelSelect(globalDefaultKey, fallback?.default);
			return;
		}
		setSelectedModel(globalDefaultKey);
		persistSelectedModel(globalDefaultKey);
	}, [selectedModel, globalDefaultKey, options, scope, setSelectedModel]);

	// 图片能力标记跟随目录里的真实选中项；目录未就绪时不改，避免把已有标记清掉。
	useEffect(() => {
		if (options.length === 0) return;
		setModelSupportsImages(catalogOption?.supportsImage ?? false);
	}, [options.length, catalogOption, setModelSupportsImages]);

	// 没有记住过档位时用模型默认档位播种，保证发送 prompt 时总有一个值。
	useEffect(() => {
		if (scope || !selectedModel || !resolvedReasoning) return;
		const remembered = reasoningByModel[selectedModel];
		if (!remembered || !isValidReasoningLevel(remembered, resolvedReasoning)) {
			setReasoningByModel({ ...reasoningByModel, [selectedModel]: resolvedReasoning.default });
		}
	}, [selectedModel, resolvedReasoning, reasoningByModel, setReasoningByModel, scope]);

	return { empty: picker.empty, viewProps: picker.viewProps };
}
