import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { Context, FetchFunction, Message, Model } from "../../types.js";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "../github-copilot-headers.js";
import { resolveOpenAICompletionsCompat } from "./compatibility.js";
import { convertMessages, convertTools } from "./messages.js";
import type { OpenAICompletionsOptions } from "./options.js";

export function createOpenAICompletionsClient(
	model: Model<"openai-completions">,
	context: Context,
	apiKey?: string,
	optionsHeaders?: Record<string, string>,
	providerFetch?: FetchFunction,
): OpenAI {
	let resolvedApiKey = apiKey;
	if (!resolvedApiKey) {
		if (!process.env.OPENAI_API_KEY) {
			throw new Error(
				"OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.",
			);
		}
		resolvedApiKey = process.env.OPENAI_API_KEY;
	}

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
	if (optionsHeaders) Object.assign(headers, optionsHeaders);

	return new OpenAI({
		apiKey: resolvedApiKey,
		baseURL: model.gatewayUrl || model.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders: headers,
		fetch: providerFetch,
	});
}

export function buildOpenAICompletionsParams(
	model: Model<"openai-completions">,
	context: Context,
	options?: OpenAICompletionsOptions,
): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
	const compat = resolveOpenAICompletionsCompat(model);
	const messages = convertMessages(model, context, compat);
	maybeAddOpenRouterAnthropicCacheControl(model, messages);

	const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
		model: model.id,
		messages,
		stream: true,
	};

	if (compat.supportsUsageInStreaming !== false) setExtraParam(params, "stream_options", { include_usage: true });
	if (compat.supportsStore) params.store = false;
	if (options?.maxTokens) {
		if (compat.maxTokensField === "max_tokens") setExtraParam(params, "max_tokens", options.maxTokens);
		else params.max_completion_tokens = options.maxTokens;
	}
	if (options?.temperature !== undefined) params.temperature = options.temperature;
	if (context.tools) params.tools = convertTools(context.tools, compat);
	else if (hasToolHistory(context.messages)) params.tools = [];
	if (options?.toolChoice) params.tool_choice = options.toolChoice;

	applyThinkingOptions(params, model, options, compat.thinkingFormat, compat.supportsReasoningEffort);
	applyRoutingOptions(params, model);
	return params;
}

function applyThinkingOptions(
	params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
	model: Model<"openai-completions">,
	options: OpenAICompletionsOptions | undefined,
	format: "openai" | "zai" | "qwen" | "nvidia" | "deepseek",
	supportsReasoningEffort: boolean,
): void {
	if (format === "zai") {
		setExtraParam(params, "thinking", { type: options?.reasoningEffort ? "enabled" : "disabled" });
		if (options?.reasoningEffort) setExtraParam(params, "reasoning_effort", options.reasoningEffort);
		return;
	}
	if (format === "qwen") {
		const effort = options?.reasoningEffort === "minimal" ? "low" : options?.reasoningEffort;
		const enabled = !!effort;
		setExtraParam(params, "enable_thinking", enabled);
		setExtraParam(params, "chat_template_kwargs", { enable_thinking: enabled });
		if (effort) setExtraParam(params, "reasoning_effort", effort);
		return;
	}
	if (format === "nvidia") {
		setExtraParam(params, "chat_template_kwargs", { enable_thinking: !!options?.reasoningEffort });
		return;
	}
	if (format === "deepseek") {
		setExtraParam(
			params,
			"thinking",
			options?.reasoningEffort
				? { type: "enabled", reasoning_effort: options.reasoningEffort }
				: { type: "disabled" },
		);
		return;
	}
	if (!model.reasoning || !supportsReasoningEffort) return;

	const isOpenAIOfficial = model.baseUrl.includes("api.openai.com");
	const effort = options?.reasoningEffort;
	const isOff = !effort || effort === "off";
	if (isOff) {
		if (isOpenAIOfficial) setExtraParam(params, "reasoning_effort", "none");
	} else if (effort === "none") {
		setExtraParam(params, "reasoning_effort", "none");
	} else {
		setExtraParam(params, "reasoning_effort", effort === "minimal" && !isOpenAIOfficial ? "low" : effort);
	}
}

function applyRoutingOptions(
	params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
	model: Model<"openai-completions">,
): void {
	if (model.baseUrl.includes("openrouter.ai") && model.compat?.openRouterRouting) {
		setExtraParam(params, "provider", model.compat.openRouterRouting);
	}
	if (model.baseUrl.includes("ai-gateway.vercel.sh") && model.compat?.vercelGatewayRouting) {
		const routing = model.compat.vercelGatewayRouting;
		if (routing.only || routing.order) {
			const gateway: Record<string, string[]> = {};
			if (routing.only) gateway.only = routing.only;
			if (routing.order) gateway.order = routing.order;
			setExtraParam(params, "providerOptions", { gateway });
		}
	}
}

function maybeAddOpenRouterAnthropicCacheControl(
	model: Model<"openai-completions">,
	messages: ChatCompletionMessageParam[],
): void {
	if (model.provider !== "openrouter" || !model.id.startsWith("anthropic/")) return;

	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "user" && message.role !== "assistant") continue;
		const content = message.content;
		if (typeof content === "string") {
			message.content = [
				Object.assign({ type: "text" as const, text: content }, { cache_control: { type: "ephemeral" } }),
			];
			return;
		}
		if (!Array.isArray(content)) continue;
		for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex--) {
			const part = content[contentIndex];
			if (part?.type === "text") {
				Object.assign(part, { cache_control: { type: "ephemeral" } });
				return;
			}
		}
	}
}

function hasToolHistory(messages: Message[]): boolean {
	return messages.some(
		(message) =>
			message.role === "toolResult" ||
			(message.role === "assistant" && message.content.some((block) => block.type === "toolCall")),
	);
}

function setExtraParam(
	params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
	key: string,
	value: unknown,
): void {
	(params as unknown as Record<string, unknown>)[key] = value;
}
