import OpenAI from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import type { Context, Model, Usage } from "../../types.js";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "../github-copilot-headers.js";
import { convertResponsesMessages, convertResponsesTools } from "./messages.js";
import type { OpenAIResponsesOptions } from "./options.js";

const OPENAI_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);

type ResponsesReasoning = NonNullable<ResponseCreateParamsStreaming["reasoning"]>;

export function createOpenAIResponsesClient(
	model: Model<"openai-responses">,
	context: Context,
	apiKey: string,
	options?: OpenAIResponsesOptions,
): OpenAI {
	const headers = { ...model.headers };
	if (model.provider === "github-copilot") {
		Object.assign(
			headers,
			buildCopilotDynamicHeaders({
				messages: context.messages,
				hasImages: hasCopilotVisionInput(context.messages),
			}),
		);
	}
	Object.assign(headers, options?.headers);

	return new OpenAI({
		apiKey,
		baseURL: model.gatewayUrl || model.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders: headers,
		fetch: options?.fetch,
	});
}

export function buildOpenAIResponsesParams(
	model: Model<"openai-responses">,
	context: Context,
	options?: OpenAIResponsesOptions,
): ResponseCreateParamsStreaming {
	const cacheRetention = resolveCacheRetention(options?.cacheRetention);
	const params: ResponseCreateParamsStreaming = {
		model: model.id,
		input: convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS),
		stream: true,
		prompt_cache_key: cacheRetention === "none" ? undefined : options?.sessionId,
		prompt_cache_retention: getPromptCacheRetention(model.baseUrl, cacheRetention),
		store: false,
	};

	if (options?.maxTokens) params.max_output_tokens = options.maxTokens;
	if (options?.temperature !== undefined) params.temperature = options.temperature;
	if (options?.serviceTier !== undefined) params.service_tier = options.serviceTier;
	if (context.tools) params.tools = convertResponsesTools(context.tools);

	if (model.reasoning) {
		const effort = !options?.reasoningEffort || options.reasoningEffort === "off" ? "none" : options.reasoningEffort;
		params.reasoning = {
			effort: effort as ResponsesReasoning["effort"],
			summary: options?.reasoningSummary || "auto",
		};
		if (effort !== "none") params.include = ["reasoning.encrypted_content"];
	}

	return params;
}

export function applyServiceTierPricing(
	usage: Usage,
	serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
): void {
	const multiplier = getServiceTierCostMultiplier(serviceTier);
	if (multiplier === 1) return;
	usage.cost.input *= multiplier;
	usage.cost.output *= multiplier;
	usage.cost.cacheRead *= multiplier;
	usage.cost.cacheWrite *= multiplier;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}

function resolveCacheRetention(cacheRetention: OpenAIResponsesOptions["cacheRetention"]): "none" | "short" | "long" {
	if (cacheRetention) return cacheRetention;
	if (typeof process !== "undefined" && process.env.PI_CACHE_RETENTION === "long") return "long";
	return "short";
}

function getPromptCacheRetention(baseUrl: string, cacheRetention: "none" | "short" | "long"): "24h" | undefined {
	return cacheRetention === "long" && baseUrl.includes("api.openai.com") ? "24h" : undefined;
}

function getServiceTierCostMultiplier(serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined): number {
	switch (serviceTier) {
		case "flex":
			return 0.5;
		case "priority":
			return 2;
		default:
			return 1;
	}
}
