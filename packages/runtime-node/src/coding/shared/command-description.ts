import type { CommandToolName } from "./command-tool.js";

/**
 * 每次调用都是全新 shell，任何一次调用里的 cd/export/source 都不会带到下一次。
 * 该行为与「会话内环境延续」的直觉相反，必须写进描述，否则模型会假设上一步的
 * 目录与环境仍然有效（见 issue #4）。
 */
const STATELESS_SHELL_NOTE =
	"\n\nEach call runs in a new, independent shell process. Working directory, environment variables, PATH, " +
	"shell options, aliases, functions, and any state set by cd/export/source in one call are NOT carried over to " +
	"the next: every call starts again from the session working directory with the default environment. Set up the " +
	"state inside the same command that needs it — e.g. prefix with `cd <dir> && ...`, or assign the variable in " +
	"that same invocation. Do not rely on a previous call having changed directory or exported anything.";

export function createCommandToolDescription(toolName: CommandToolName): string {
	const platformNote = toolName === "shell" ? "\n\nOn Windows, this tool uses PowerShell by default." : "";
	return `Execute a ${toolName} command in the current working directory. Returns stdout and stderr. Output may be truncated and saved to a temporary file. Supports foreground execution, timeout, and managed background execution.${platformNote}${STATELESS_SHELL_NOTE}`;
}
