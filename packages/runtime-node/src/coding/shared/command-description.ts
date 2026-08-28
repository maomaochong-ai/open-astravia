import type { CommandToolName } from "./command-tool.js";

export function createCommandToolDescription(toolName: CommandToolName): string {
	const platformNote = toolName === "shell" ? "\n\nOn Windows, this tool uses PowerShell by default." : "";
	return `Execute a ${toolName} command in the current working directory. Returns stdout and stderr. Output may be truncated and saved to a temporary file. Supports foreground execution, timeout, and managed background execution.${platformNote}`;
}
