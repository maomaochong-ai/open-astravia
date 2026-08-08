import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/messages.js";
import type { Context, Model } from "../../types.js";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.js";
import { getCacheControl } from "./cache.js";
import { convertMessages } from "./messages.js";
import type { AnthropicOptions } from "./options.js";
import { supportsAdaptiveThinking } from "./options.js";
import { convertTools } from "./tools.js";

export function buildAnthropicParams(
	model: Model<"anthropic-messages">,
	context: Context,
	isOAuthToken: boolean,
	options?: AnthropicOptions,
): MessageCreateParamsStreaming {
	const { cacheControl } = getCacheControl(model.baseUrl, options?.cacheRetention);
	const params: MessageCreateParamsStreaming = {
		model: model.id,
		messages: convertMessages(context.messages, model, isOAuthToken, cacheControl),
		max_tokens: options?.maxTokens || (model.maxTokens / 3) | 0,
		stream: true,
	};

	if (isOAuthToken) {
		params.system = [
			{
				type: "text",
				text: "You are Claude Code, Anthropic's official CLI for Claude.",
				...(cacheControl ? { cache_control: cacheControl } : {}),
			},
		];
		if (context.systemPrompt) {
			params.system.push({
				type: "text",
				text: sanitizeSurrogates(context.systemPrompt),
				...(cacheControl ? { cache_control: cacheControl } : {}),
			});
		}
	} else if (context.systemPrompt) {
		params.system = [
			{
				type: "text",
				text: sanitizeSurrogates(context.systemPrompt),
				...(cacheControl ? { cache_control: cacheControl } : {}),
			},
		];
	}

	if (options?.temperature !== undefined) params.temperature = options.temperature;
	if (context.tools) params.tools = convertTools(context.tools, isOAuthToken);
	applyThinkingOptions(params, model, options);

	const userId = options?.metadata?.user_id;
	if (typeof userId === "string") params.metadata = { user_id: userId };
	if (options?.toolChoice) {
		params.tool_choice = typeof options.toolChoice === "string" ? { type: options.toolChoice } : options.toolChoice;
	}
	return params;
}

function applyThinkingOptions(
	params: MessageCreateParamsStreaming,
	model: Model<"anthropic-messages">,
	options?: AnthropicOptions,
): void {
	const isOfficialAnthropic = (model.gatewayUrl || model.baseUrl).includes("api.anthropic.com");
	if (options?.thinkingEnabled) {
		if (model.reasoning) {
			if (supportsAdaptiveThinking(model.id)) {
				params.thinking = { type: "adaptive" };
				if (options.effort) params.output_config = { effort: options.effort };
			} else {
				params.thinking = { type: "enabled", budget_tokens: options.thinkingBudgetTokens || 1024 };
			}
		} else if (!isOfficialAnthropic) {
			params.thinking = { type: "enabled", budget_tokens: options.thinkingBudgetTokens || 1024 };
		}
	} else if (supportsAdaptiveThinking(model.id) || !isOfficialAnthropic) {
		params.thinking = { type: "disabled" };
	}
}
