import type { CodingToolRegistration } from "../../tool-registration.js";
import {
	createExtractTextFromPdfTool,
	type ExtractTextFromPdfToolInput,
	type ExtractTextFromPdfToolOptions,
} from "./extract-text-from-pdf-tool.js";

export function createExtractTextFromPdfToolRegistration(
	cwd: string,
	options: ExtractTextFromPdfToolOptions,
): CodingToolRegistration<ExtractTextFromPdfToolInput> {
	return {
		tool: createExtractTextFromPdfTool(cwd, options),
		modelOrder: options.modelOrder,
	};
}
