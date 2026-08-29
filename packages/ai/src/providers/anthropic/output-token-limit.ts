import type { ModelWarning } from "../../runtime/model-call-result.js";
import type { Model } from "../../types.js";

/** Anthropic requires max_tokens even when an OpenAI-compatible endpoint could omit the limit. */
export const ANTHROPIC_UNKNOWN_MODEL_MAX_TOKENS = 4_096;

export interface AnthropicOutputTokenLimitResolution {
	readonly maxTokens: number;
	readonly warnings: readonly ModelWarning[];
}

export function resolveAnthropicOutputTokenLimit(
	model: Model<"anthropic-messages">,
	requestedMaxTokens: number | undefined,
): AnthropicOutputTokenLimitResolution {
	const configured = requestedMaxTokens ?? model.maxTokens;
	if (configured !== undefined) return { maxTokens: configured, warnings: [] };
	return {
		maxTokens: ANTHROPIC_UNKNOWN_MODEL_MAX_TOKENS,
		warnings: [
			{
				code: "unknown-model-output-limit",
				provider: model.provider,
				message:
					`The output token limit for model "${model.id}" is unknown. ` +
					`Anthropic requires max_tokens, so the request uses an output budget of ${ANTHROPIC_UNKNOWN_MODEL_MAX_TOKENS}. ` +
					"Configure maxTokens explicitly to override this fallback.",
			},
		],
	};
}
