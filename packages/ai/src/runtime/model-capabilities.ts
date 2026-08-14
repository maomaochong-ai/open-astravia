import type { ModelCapabilities } from "../protocol/model-capabilities.js";
import type { Api, Model } from "../types.js";

const DEFAULT_SUPPORTED_URLS = ["http://", "https://"] as const;

export function resolveModelCapabilities(model: Model<Api>): ModelCapabilities {
	return (
		model.capabilities ?? {
			streaming: true,
			tools: true,
			structuredOutput: false,
			reasoning: model.reasoning,
			parallelToolCalls: false,
			input: model.input,
			supportedUrls: DEFAULT_SUPPORTED_URLS,
		}
	);
}

export function resolveEffectiveModelCapabilities(
	model: Model<Api>,
	adapterCapabilities?: Partial<ModelCapabilities>,
): ModelCapabilities {
	const modelCapabilities = resolveModelCapabilities(model);
	if (!adapterCapabilities) return modelCapabilities;
	return {
		streaming: modelCapabilities.streaming && (adapterCapabilities.streaming ?? true),
		tools: modelCapabilities.tools && (adapterCapabilities.tools ?? true),
		structuredOutput: modelCapabilities.structuredOutput && (adapterCapabilities.structuredOutput ?? true),
		reasoning: modelCapabilities.reasoning && (adapterCapabilities.reasoning ?? true),
		parallelToolCalls: modelCapabilities.parallelToolCalls && (adapterCapabilities.parallelToolCalls ?? true),
		input: modelCapabilities.input.filter((input) =>
			(adapterCapabilities.input ?? modelCapabilities.input).includes(input),
		),
		supportedUrls: adapterCapabilities.supportedUrls ?? modelCapabilities.supportedUrls,
	};
}
