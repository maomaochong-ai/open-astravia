import type { CodingToolRegistration } from "../../tool-registration.js";
import { createGrepTool, type GrepToolInput, type GrepToolOptions } from "./grep-tool.js";

export function createGrepToolRegistration(
	cwd: string,
	options: GrepToolOptions = {},
): CodingToolRegistration<GrepToolInput> {
	return {
		tool: createGrepTool(cwd, options),
	};
}
