import { join } from "node:path";
import type { ThinkingLevel } from "@vetta/agent-core";
import type { Api, Model } from "@vetta/ai";
import { getDocsPath } from "../../config.js";
import { type CodingAgentModelRuntime, DEFAULT_THINKING_LEVEL, findInitialModel } from "../../models/index.js";
import type { CreateCodingAgentSessionOptions } from "../../public-api/sdk/index.js";
import type { SettingsRuntime } from "../../settings/index.js";
import { CODING_AGENT_SDK_HOST_ERROR_CODES, CodingAgentSdkHostError } from "./contracts.js";

export interface CodingAgentSdkInitialModel {
	readonly model: Model<Api>;
	readonly thinkingLevel: ThinkingLevel;
	readonly modelFallbackMessage?: string;
}

export async function resolveSdkInitialModel(
	options: CreateCodingAgentSessionOptions,
	modelRegistry: CodingAgentModelRuntime,
	settingsManager: SettingsRuntime,
): Promise<CodingAgentSdkInitialModel> {
	let model: Model<Api> | undefined = options.model;

	if (!model) {
		const result = await findInitialModel({
			scopedModels: options.scopedModels ? [...options.scopedModels] : [],
			isContinuing: false,
			defaultProvider: settingsManager.getDefaultProvider(),
			defaultModelId: settingsManager.getDefaultModel(),
			defaultThinkingLevel: settingsManager.getDefaultThinkingLevel(),
			models: modelRegistry,
		});
		model = result.model;
		if (!model) {
			throw new CodingAgentSdkHostError(
				CODING_AGENT_SDK_HOST_ERROR_CODES.NO_MODEL,
				`No models available. Use /login or set an API key environment variable. See ${join(getDocsPath(), "models.md")}. Then use /model to select a model.`,
			);
		}
	}

	let thinkingLevel = options.thinkingLevel;
	thinkingLevel ??= settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
	if (!model.reasoning) thinkingLevel = "off";
	return { model, thinkingLevel };
}
