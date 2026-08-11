import { type PluginAiModel, useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useState } from "react";
import { useContentCreationRuntime } from "../plugin/runtime-context";
import type { ContentPromptOptimizationService } from "./prompt-optimization-service";

interface PromptOptimizationModelState {
	models: PluginAiModel[];
	selectedModelKey?: string;
	setSelectedModelKey: (modelKey: string) => void;
	isLoadingModels: boolean;
	optimizePrompt: ContentPromptOptimizationService["optimize"];
	reportError: (message: string, error: unknown) => void;
}

export function usePromptOptimizationModels(preferredModelKey?: string): PromptOptimizationModelState {
	const runtime = useContentCreationRuntime();
	const { t } = useTranslation();
	const [models, setModels] = useState<PluginAiModel[]>([]);
	const [selectedModelKey, setSelectedModelKey] = useState<string | undefined>(preferredModelKey);
	const [isLoadingModels, setIsLoadingModels] = useState(true);
	const loadErrorMessage = t("error.promptOptimizationModels");

	useEffect(() => {
		let active = true;
		setIsLoadingModels(true);
		void runtime.promptOptimization
			.listModels()
			.then((result) => {
				if (!active) return;
				const textModels = result.models.filter((model) => model.input.includes("text"));
				setModels(textModels);
				setSelectedModelKey((current) => {
					if (current && textModels.some((model) => model.modelKey === current)) return current;
					if (result.defaultModel && textModels.some((model) => model.modelKey === result.defaultModel)) {
						return result.defaultModel;
					}
					return textModels[0]?.modelKey;
				});
			})
			.catch((error: unknown) => {
				if (active) runtime.notifyError(loadErrorMessage, error);
			})
			.finally(() => {
				if (active) setIsLoadingModels(false);
			});
		return () => {
			active = false;
		};
	}, [loadErrorMessage, runtime]);

	return {
		models,
		selectedModelKey,
		setSelectedModelKey,
		isLoadingModels,
		optimizePrompt: (request) => runtime.promptOptimization.optimize(request),
		reportError: (message, error) => runtime.notifyError(message, error),
	};
}
