import {
	type CommandToolExecutor,
	type CommandToolInput,
	CommandToolInputSchema,
	createCommandTool,
} from "../../shared/command-tool.js";
import { SHELL_TOOL_DESCRIPTION } from "./description.js";

export type ShellToolInput = CommandToolInput;

export interface ShellToolOptions {
	readonly executor: CommandToolExecutor;
}

export function createShellTool(cwd: string, options: ShellToolOptions) {
	return createCommandTool({
		name: "shell",
		description: SHELL_TOOL_DESCRIPTION,
		cwd,
		executor: options.executor,
	});
}

export { CommandToolInputSchema as ShellToolInputSchema };
