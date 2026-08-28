import type { CodingToolRegistration } from "../../tool-registration.js";
import { createGlobTool, type GlobToolInput, type GlobToolOptions } from "./glob-tool.js";

export function createGlobToolRegistration(
	cwd: string,
	options: GlobToolOptions = {},
): CodingToolRegistration<GlobToolInput> {
	return {
		tool: createGlobTool(cwd, options),
	};
}
