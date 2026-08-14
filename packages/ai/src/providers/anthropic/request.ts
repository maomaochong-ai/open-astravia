import type { MessageCreateParamsStreaming, TextBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import type { Context, Model } from "../../types.js";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.js";
import { type AnthropicCacheControl, getCacheControl } from "./cache.js";
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
			...buildSystemBlocks(context, cacheControl),
		];
	} else {
		const systemBlocks = buildSystemBlocks(context, cacheControl);
		if (systemBlocks.length > 0) params.system = systemBlocks;
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

/**
 * Renders the system prompt as one text block, or as a cached stable prefix plus an
 * uncached volatile tail when the caller declared a split point.
 *
 * The split is skipped without a cache breakpoint (nothing to gain, one extra block to pay for)
 * and when the split point sits at either end of the prompt (an empty block is rejected upstream).
 */
function buildSystemBlocks(context: Context, cacheControl: AnthropicCacheControl | undefined): TextBlockParam[] {
	const systemPrompt = context.systemPrompt;
	if (!systemPrompt) return [];

	const stableLength = context.systemPromptStableLength;
	if (cacheControl && stableLength !== undefined && stableLength > 0 && stableLength < systemPrompt.length) {
		// Slice before sanitizing: stableLength is an offset into the raw prompt.
		return [
			{ type: "text", text: sanitizeSurrogates(systemPrompt.slice(0, stableLength)), cache_control: cacheControl },
			{ type: "text", text: sanitizeSurrogates(systemPrompt.slice(stableLength)) },
		];
	}

	return [
		{
			type: "text",
			text: sanitizeSurrogates(systemPrompt),
			...(cacheControl ? { cache_control: cacheControl } : {}),
		},
	];
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
