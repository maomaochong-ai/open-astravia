import type { CodingToolRegistration } from "../../tool-registration.js";
import { createFindTool, type FindToolInput, type FindToolOptions } from "./find-tool.js";

export function createFindToolRegistration(
	cwd: string,
	options: FindToolOptions = {},
): CodingToolRegistration<FindToolInput> {
	return {
		tool: createFindTool(cwd, options),
	};
}
