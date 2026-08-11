import type { ThinkingConfig } from "@google/genai";
import type { ModelCallRequest } from "../../runtime/language-model-adapter.js";
import { buildGoogleGenerateContentParams } from "../google-stream/request.js";
import type { GoogleThinkingLevel } from "../google-stream/thinking.js";
import type { GoogleOptions } from "./options.js";

export function buildGoogleParams(request: ModelCallRequest<"google-generative-ai", GoogleOptions>) {
	return buildGoogleGenerateContentParams(
		request.model,
		request.context,
		request.options,
		(level) => level as GoogleThinkingLevel as ThinkingConfig["thinkingLevel"],
	);
}
