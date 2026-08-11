import type { ThinkingLevel } from "@vetta/agent-core";
import { modelsAreEqual } from "@vetta/ai";
import chalk from "chalk";
import { minimatch } from "minimatch";
import type { CodingAgentModelCatalogView } from "../model-contracts.js";
import { parseModelPattern } from "./model-pattern.js";
import { isValidThinkingLevel } from "./model-selection-defaults.js";

export interface ScopedModel {
	readonly model: ReturnType<CodingAgentModelCatalogView["getAll"]>[number];
	readonly thinkingLevel?: ThinkingLevel;
}

export async function resolveModelScope(
	patterns: readonly string[],
	catalog: Pick<CodingAgentModelCatalogView, "getAvailable">,
): Promise<ScopedModel[]> {
	const availableModels = await catalog.getAvailable();
	const scopedModels: ScopedModel[] = [];
	for (const pattern of patterns) {
		if (pattern.includes("*") || pattern.includes("?") || pattern.includes("[")) {
			const colonIndex = pattern.lastIndexOf(":");
			let globPattern = pattern;
			let thinkingLevel: ThinkingLevel | undefined;
			if (colonIndex !== -1) {
				const suffix = pattern.substring(colonIndex + 1);
				if (isValidThinkingLevel(suffix)) {
					thinkingLevel = suffix;
					globPattern = pattern.substring(0, colonIndex);
				}
			}
			const matches = availableModels.filter((model) => {
				const fullId = `${model.provider}/${model.id}`;
				return (
					minimatch(fullId, globPattern, { nocase: true }) || minimatch(model.id, globPattern, { nocase: true })
				);
			});
			if (matches.length === 0) {
				console.warn(chalk.yellow(`Warning: No models match pattern "${pattern}"`));
				continue;
			}
			for (const model of matches) {
				if (!scopedModels.some((entry) => modelsAreEqual(entry.model, model))) {
					scopedModels.push({ model, thinkingLevel });
				}
			}
			continue;
		}
		const result = parseModelPattern(pattern, availableModels);
		if (result.warning) console.warn(chalk.yellow(`Warning: ${result.warning}`));
		if (!result.model) {
			console.warn(chalk.yellow(`Warning: No models match pattern "${pattern}"`));
			continue;
		}
		const model = result.model;
		if (!scopedModels.some((entry) => modelsAreEqual(entry.model, model))) {
			scopedModels.push({ model, thinkingLevel: result.thinkingLevel });
		}
	}
	return scopedModels;
}
