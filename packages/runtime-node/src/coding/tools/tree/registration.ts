import type { CodingToolRegistration } from "../../tool-registration.js";
import { createTreeTool, type TreeToolInput, type TreeToolOptions } from "./tree-tool.js";

export function createTreeToolRegistration(
	cwd: string,
	options: TreeToolOptions = {},
): CodingToolRegistration<TreeToolInput> {
	return {
		tool: createTreeTool(cwd, options),
	};
}
