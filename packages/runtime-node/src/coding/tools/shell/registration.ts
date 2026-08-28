import type { CodingToolRegistration } from "../../tool-registration.js";
import { createShellTool, type ShellToolInput, type ShellToolOptions } from "./shell-tool.js";

export type ShellToolRegistrationOptions = ShellToolOptions;

export function createShellToolRegistration(
	cwd: string,
	options: ShellToolRegistrationOptions,
): CodingToolRegistration<ShellToolInput> {
	return {
		tool: createShellTool(cwd, options),
	};
}
