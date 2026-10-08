import type { GenerateContentConfig, GenerateContentParameters, ThinkingConfig } from "@google/genai";
import { AI_ERROR_CODES, AIError } from "../../protocol/index.js";
import type { Context, Model, StreamOptions } from "../../types.js";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.js";
import { convertMessages, convertTools, mapToolChoice } from "../google-shared.js";

export interface GoogleGenerationOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "any";
	thinking?: {
		enabled: boolean;
		budgetTokens?: number;
		level?: string;
	};
}

type GoogleApi = "google-generative-ai" | "google-gemini-cli" | "google-vertex";

export function buildGoogleGenerateContentParams<TApi extends GoogleApi>(
	model: Model<TApi>,
	context: Context,
	options: GoogleGenerationOptions = {},
	resolveThinkingLevel: (level: string) => ThinkingConfig["thinkingLevel"],
): GenerateContentParameters {
	const config: GenerateContentConfig = {
		...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
		...(options.maxTokens !== undefined ? { maxOutputTokens: options.maxTokens } : {}),
		...(context.systemPrompt ? { systemInstruction: sanitizeSurrogates(context.systemPrompt) } : {}),
		...(context.tools?.length ? { tools: convertTools(context.tools) } : {}),
	};

	if (context.tools?.length && options.toolChoice) {
		config.toolConfig = { functionCallingConfig: { mode: mapToolChoice(options.toolChoice) } };
	}
	if (options.thinking?.enabled && model.reasoning) {
		const thinkingConfig: ThinkingConfig = { includeThoughts: true };
		if (options.thinking.level !== undefined) {
			thinkingConfig.thinkingLevel = resolveThinkingLevel(options.thinking.level);
		} else if (options.thinking.budgetTokens !== undefined) {
			thinkingConfig.thinkingBudget = options.thinking.budgetTokens;
		}
		config.thinkingConfig = thinkingConfig;
	}
	if (options.signal) {
		if (options.signal.aborted) throw new Error("Request aborted");
		config.abortSignal = options.signal;
	}

	const contents = convertMessages(model, context);
	if (contents.length === 0) {
		throw new AIError(AI_ERROR_CODES.INVALID_REQUEST, "Google model requests require non-empty contents", {
			provider: model.provider,
			modelId: model.id,
			phase: "request",
			retryable: false,
		});
	}
	return { model: model.id, contents, config };
}
