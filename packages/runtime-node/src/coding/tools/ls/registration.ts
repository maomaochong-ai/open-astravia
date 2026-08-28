import type { CodingToolRegistration } from "../../tool-registration.js";
import { createLsTool, type LsToolInput, type LsToolOptions } from "./ls-tool.js";

export function createLsToolRegistration(
	cwd: string,
	options: LsToolOptions = {},
): CodingToolRegistration<LsToolInput> {
	return {
		tool: createLsTool(cwd, options),
	};
}
