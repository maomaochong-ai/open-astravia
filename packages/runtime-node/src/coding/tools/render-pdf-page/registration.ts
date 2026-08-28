import type { CodingToolRegistration } from "../../tool-registration.js";
import {
	createRenderPdfPageTool,
	type RenderPdfPageToolInput,
	type RenderPdfPageToolOptions,
} from "./render-pdf-page-tool.js";

export function createRenderPdfPageToolRegistration(
	cwd: string,
	options: RenderPdfPageToolOptions,
): CodingToolRegistration<RenderPdfPageToolInput> {
	return {
		tool: createRenderPdfPageTool(cwd, options),
		modelOrder: options.modelOrder,
	};
}
