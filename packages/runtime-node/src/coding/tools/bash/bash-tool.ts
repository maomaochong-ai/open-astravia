import {
	type CommandToolExecutor,
	type CommandToolInput,
	CommandToolInputSchema,
	createCommandTool,
} from "../../shared/command-tool.js";
import { BASH_TOOL_DESCRIPTION } from "./description.js";

export type BashToolInput = CommandToolInput;

export interface BashToolOptions {
	readonly executor: CommandToolExecutor;
}

export function createBashTool(cwd: string, options: BashToolOptions) {
	return createCommandTool({
		name: "bash",
		description: BASH_TOOL_DESCRIPTION,
		cwd,
		executor: options.executor,
	});
}

export { CommandToolInputSchema as BashToolInputSchema };
