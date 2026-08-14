import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import {
	createExtractTextFromImageTool,
	type ExtractTextFromImageToolInput,
	type ExtractTextFromImageToolOptions,
} from "./extract-text-from-image-tool.js";

export const EXTRACT_TEXT_FROM_IMAGE_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];
export const EXTRACT_TEXT_FROM_IMAGE_TOOL_CATEGORY = "doc" as const;

export function createExtractTextFromImageToolRegistration(
	cwd: string,
	options: ExtractTextFromImageToolOptions,
): CodingToolRegistration<ExtractTextFromImageToolInput> {
	return {
		tool: createExtractTextFromImageTool(cwd, options),
		scopeUse: EXTRACT_TEXT_FROM_IMAGE_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: EXTRACT_TEXT_FROM_IMAGE_TOOL_CATEGORY,
	};
}
