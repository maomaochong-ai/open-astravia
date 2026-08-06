import { completeSimple } from "@vetta/ai";
import { bindCapability, type CapabilityRegistry } from "@vetta/capability-runtime";
import {
	CAPABILITY_ERROR_CODES,
	CapabilityError,
	type Disposable,
	DOMAIN_AI_CAPABILITIES,
} from "@vetta/capability-sdk";
import { getDesktopModelSettingsService } from "../models/model-settings-host.js";
import { getOrCreateSharedModelRegistry } from "../runtime.js";

const DOMAIN_AI_PROVIDER_OWNER = "vetta.domain.ai";

function assertNotAborted(signal: AbortSignal): void {
	if (signal.aborted) {
		throw new CapabilityError(CAPABILITY_ERROR_CODES.ABORTED, "Capability invocation was aborted");
	}
}

function toModelKey(provider: string, modelId: string): string {
	return `${provider}/${modelId}`;
}

export function registerDesktopAiProviders(registry: CapabilityRegistry): Disposable {
	const models = getDesktopModelSettingsService();
	const modelRegistry = getOrCreateSharedModelRegistry();

	return registry.registerOwner(DOMAIN_AI_PROVIDER_OWNER, [
		bindCapability(DOMAIN_AI_CAPABILITIES.LIST_MODELS, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				const availableModels = modelRegistry.getAvailable().filter((model) => model.input.includes("text"));
				const configuredDefault = (await models.list()).defaultModel;
				const defaultModel = availableModels.some(
					(model) => toModelKey(model.provider, model.id) === configuredDefault,
				)
					? configuredDefault
					: null;
				return {
					defaultModel,
					models: availableModels.map((model) => ({
						modelKey: toModelKey(model.provider, model.id),
						provider: model.provider,
						id: model.id,
						name: model.name,
						api: model.api,
						reasoning: model.reasoning,
						input: [...model.input],
						contextWindow: model.contextWindow,
						maxTokens: model.maxTokens,
					})),
				};
			},
		}),
		bindCapability(DOMAIN_AI_CAPABILITIES.COMPLETE, {
			execute: async (input, context) => {
				assertNotAborted(context.signal);
				const configuredDefault = input.modelKey ?? (await models.list()).defaultModel;
				if (!configuredDefault) {
					throw new CapabilityError(CAPABILITY_ERROR_CODES.NOT_FOUND, "No default AI model is configured");
				}
				const selectedModel = modelRegistry
					.getAvailable()
					.find(
						(model) => model.input.includes("text") && toModelKey(model.provider, model.id) === configuredDefault,
					);
				if (!selectedModel) {
					throw new CapabilityError(
						CAPABILITY_ERROR_CODES.NOT_FOUND,
						`AI model is not available: ${configuredDefault}`,
					);
				}
				const apiKey = await modelRegistry.getApiKey(selectedModel);
				if (!apiKey) {
					throw new CapabilityError(
						CAPABILITY_ERROR_CODES.PROVIDER_FAILED,
						`AI model credentials are unavailable: ${configuredDefault}`,
					);
				}

				const response = await completeSimple(
					selectedModel,
					{
						...(input.systemPrompt === undefined ? {} : { systemPrompt: input.systemPrompt }),
						messages: [{ role: "user", content: input.prompt, timestamp: Date.now() }],
					},
					{
						apiKey,
						signal: context.signal,
						...(input.temperature === undefined ? {} : { temperature: input.temperature }),
						...(input.maxTokens === undefined
							? {}
							: { maxTokens: Math.min(input.maxTokens, selectedModel.maxTokens) }),
						...(input.reasoning === undefined || !selectedModel.reasoning ? {} : { reasoning: input.reasoning }),
					},
				);
				assertNotAborted(context.signal);
				if (response.stopReason !== "stop" && response.stopReason !== "length") {
					throw new CapabilityError(
						response.stopReason === "aborted"
							? CAPABILITY_ERROR_CODES.ABORTED
							: CAPABILITY_ERROR_CODES.PROVIDER_FAILED,
						response.errorMessage ?? `AI completion stopped with reason: ${response.stopReason}`,
					);
				}
				return {
					modelKey: configuredDefault,
					text: response.content
						.filter((content) => content.type === "text")
						.map((content) => content.text)
						.join(""),
					stopReason: response.stopReason,
					usage: {
						inputTokens: response.usage.input,
						outputTokens: response.usage.output,
						totalTokens: response.usage.totalTokens,
					},
				};
			},
		}),
	]);
}
