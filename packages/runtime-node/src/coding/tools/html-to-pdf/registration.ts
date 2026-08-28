import type { CodingToolRegistration } from "../../tool-registration.js";
import { createHtmlToPdfTool, type HtmlToPdfToolInput, type HtmlToPdfToolOptions } from "./html-to-pdf-tool.js";

export function createHtmlToPdfToolRegistration(
	cwd: string,
	options: HtmlToPdfToolOptions,
): CodingToolRegistration<HtmlToPdfToolInput> {
	return {
		tool: createHtmlToPdfTool(cwd, options),
		modelOrder: options.modelOrder,
	};
}
