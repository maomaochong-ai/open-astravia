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
