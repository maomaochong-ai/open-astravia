import type { CodingToolRegistration } from "../../tool-registration.js";
import { type BashToolInput, type BashToolOptions, createBashTool } from "./bash-tool.js";

export type BashToolRegistrationOptions = BashToolOptions;

export function createBashToolRegistration(
	cwd: string,
	options: BashToolRegistrationOptions,
): CodingToolRegistration<BashToolInput> {
	return {
		tool: createBashTool(cwd, options),
	};
}
