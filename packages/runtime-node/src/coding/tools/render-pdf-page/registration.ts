import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import {
	createRenderPdfPageTool,
	type RenderPdfPageToolInput,
	type RenderPdfPageToolOptions,
} from "./render-pdf-page-tool.js";

export const RENDER_PDF_PAGE_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];
export const RENDER_PDF_PAGE_TOOL_CATEGORY = "doc" as const;

export function createRenderPdfPageToolRegistration(
	cwd: string,
	options: RenderPdfPageToolOptions,
): CodingToolRegistration<RenderPdfPageToolInput> {
	return {
		tool: createRenderPdfPageTool(cwd, options),
		scopeUse: RENDER_PDF_PAGE_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: RENDER_PDF_PAGE_TOOL_CATEGORY,
	};
}
