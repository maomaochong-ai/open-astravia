import type { CodingToolRegistration } from "../../tool-registration.js";
import { createDocToPdfTool, type DocToPdfToolInput, type DocToPdfToolOptions } from "./doc-to-pdf-tool.js";

export function createDocToPdfToolRegistration(
	cwd: string,
	options: DocToPdfToolOptions,
): CodingToolRegistration<DocToPdfToolInput> {
	return {
		tool: createDocToPdfTool(cwd, options),
		modelOrder: options.modelOrder,
	};
}
