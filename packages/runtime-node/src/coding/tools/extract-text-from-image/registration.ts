import type { CodingToolRegistration } from "../../tool-registration.js";
import {
	createExtractTextFromImageTool,
	type ExtractTextFromImageToolInput,
	type ExtractTextFromImageToolOptions,
} from "./extract-text-from-image-tool.js";

export function createExtractTextFromImageToolRegistration(
	cwd: string,
	options: ExtractTextFromImageToolOptions,
): CodingToolRegistration<ExtractTextFromImageToolInput> {
	return {
		tool: createExtractTextFromImageTool(cwd, options),
		modelOrder: options.modelOrder,
	};
}
