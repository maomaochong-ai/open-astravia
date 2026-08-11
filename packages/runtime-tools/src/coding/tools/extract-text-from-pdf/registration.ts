import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import {
	createExtractTextFromPdfTool,
	type ExtractTextFromPdfToolInput,
	type ExtractTextFromPdfToolOptions,
} from "./extract-text-from-pdf-tool.js";

export const EXTRACT_TEXT_FROM_PDF_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];
export const EXTRACT_TEXT_FROM_PDF_TOOL_AGENT_MODES = ["work"] as const;
export const EXTRACT_TEXT_FROM_PDF_TOOL_CATEGORY = "doc" as const;

export function createExtractTextFromPdfToolRegistration(
	cwd: string,
	options: ExtractTextFromPdfToolOptions,
): CodingToolRegistration<ExtractTextFromPdfToolInput> {
	return {
		tool: createExtractTextFromPdfTool(cwd, options),
		scopeUse: EXTRACT_TEXT_FROM_PDF_TOOL_SCOPES,
		agentModes: EXTRACT_TEXT_FROM_PDF_TOOL_AGENT_MODES,
		modelOrder: options.modelOrder,
		category: EXTRACT_TEXT_FROM_PDF_TOOL_CATEGORY,
	};
}
