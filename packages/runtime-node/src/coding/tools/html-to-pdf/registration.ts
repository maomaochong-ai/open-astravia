import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createHtmlToPdfTool, type HtmlToPdfToolInput, type HtmlToPdfToolOptions } from "./html-to-pdf-tool.js";

export const HTML_TO_PDF_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];
export const HTML_TO_PDF_TOOL_CATEGORY = "doc" as const;

export function createHtmlToPdfToolRegistration(
	cwd: string,
	options: HtmlToPdfToolOptions,
): CodingToolRegistration<HtmlToPdfToolInput> {
	return {
		tool: createHtmlToPdfTool(cwd, options),
		scopeUse: HTML_TO_PDF_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: HTML_TO_PDF_TOOL_CATEGORY,
	};
}
