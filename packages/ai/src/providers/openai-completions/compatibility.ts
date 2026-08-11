import type { Model, OpenAICompletionsCompat } from "../../types.js";

export function resolveOpenAICompletionsCompat(model: Model<"openai-completions">): Required<OpenAICompletionsCompat> {
	const detected = detectCompat(model);
	if (!model.compat) return detected;

	return {
		supportsStore: model.compat.supportsStore ?? detected.supportsStore,
		supportsDeveloperRole: model.compat.supportsDeveloperRole ?? detected.supportsDeveloperRole,
		supportsReasoningEffort: model.compat.supportsReasoningEffort ?? detected.supportsReasoningEffort,
		supportsUsageInStreaming: model.compat.supportsUsageInStreaming ?? detected.supportsUsageInStreaming,
		maxTokensField: model.compat.maxTokensField ?? detected.maxTokensField,
		requiresToolResultName: model.compat.requiresToolResultName ?? detected.requiresToolResultName,
		requiresAssistantAfterToolResult:
			model.compat.requiresAssistantAfterToolResult ?? detected.requiresAssistantAfterToolResult,
		requiresThinkingAsText: model.compat.requiresThinkingAsText ?? detected.requiresThinkingAsText,
		requiresMistralToolIds: model.compat.requiresMistralToolIds ?? detected.requiresMistralToolIds,
		thinkingFormat: model.compat.thinkingFormat ?? detected.thinkingFormat,
		openRouterRouting: model.compat.openRouterRouting ?? {},
		vercelGatewayRouting: model.compat.vercelGatewayRouting ?? detected.vercelGatewayRouting,
		supportsStrictMode: model.compat.supportsStrictMode ?? detected.supportsStrictMode,
	};
}

function detectCompat(model: Model<"openai-completions">): Required<OpenAICompletionsCompat> {
	const provider = model.provider;
	const baseUrl = model.baseUrl;
	const isZai =
		provider === "zai" || provider === "zhipu" || baseUrl.includes("api.z.ai") || baseUrl.includes("bigmodel.cn");
	const isNonStandard =
		provider === "cerebras" ||
		baseUrl.includes("cerebras.ai") ||
		provider === "xai" ||
		baseUrl.includes("api.x.ai") ||
		provider === "mistral" ||
		baseUrl.includes("mistral.ai") ||
		baseUrl.includes("chutes.ai") ||
		baseUrl.includes("deepseek.com") ||
		isZai ||
		provider === "opencode" ||
		baseUrl.includes("opencode.ai");
	const useMaxTokens = provider === "mistral" || baseUrl.includes("mistral.ai") || baseUrl.includes("chutes.ai");
	const isGrok = provider === "xai" || baseUrl.includes("api.x.ai");
	const isMistral = provider === "mistral" || baseUrl.includes("mistral.ai");
	const supportsDeveloperRole =
		provider === "openai" || provider === "github-copilot" || baseUrl.includes("api.openai.com");

	return {
		supportsStore: !isNonStandard,
		supportsDeveloperRole,
		supportsReasoningEffort: !isGrok && !isZai,
		supportsUsageInStreaming: true,
		maxTokensField: useMaxTokens ? "max_tokens" : "max_completion_tokens",
		requiresToolResultName: isMistral,
		requiresAssistantAfterToolResult: false,
		requiresThinkingAsText: isMistral,
		requiresMistralToolIds: isMistral,
		thinkingFormat: isZai ? "zai" : "openai",
		openRouterRouting: {},
		vercelGatewayRouting: {},
		supportsStrictMode: true,
	};
}
