import { ThinkingLevel } from "@google/genai";
import type { ModelCallRequest } from "../../runtime/language-model-adapter.js";
import { buildGoogleGenerateContentParams } from "../google-stream/request.js";
import type { GoogleThinkingLevel } from "../google-stream/thinking.js";
import type { GoogleVertexOptions } from "./options.js";

const thinkingLevelMap: Record<GoogleThinkingLevel, ThinkingLevel> = {
	THINKING_LEVEL_UNSPECIFIED: ThinkingLevel.THINKING_LEVEL_UNSPECIFIED,
	MINIMAL: ThinkingLevel.MINIMAL,
	LOW: ThinkingLevel.LOW,
	MEDIUM: ThinkingLevel.MEDIUM,
	HIGH: ThinkingLevel.HIGH,
};

export function buildGoogleVertexParams(request: ModelCallRequest<"google-vertex", GoogleVertexOptions>) {
	return buildGoogleGenerateContentParams(
		request.model,
		request.context,
		request.options,
		(level) => thinkingLevelMap[level as GoogleThinkingLevel],
	);
}
