import type { CodingToolRegistration } from "../../tool-registration.js";
import { createWriteTool, type WriteToolInput, type WriteToolOptions } from "./write-tool.js";

export function createWriteToolRegistration(
	cwd: string,
	options: WriteToolOptions,
): CodingToolRegistration<WriteToolInput> {
	return {
		tool: createWriteTool(cwd, options),
	};
}
