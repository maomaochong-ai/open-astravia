import type Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "../../types.js";

const claudeCodeTools = [
	"Read",
	"Write",
	"Edit",
	"Bash",
	"Grep",
	"Glob",
	"AskUserQuestion",
	"EnterPlanMode",
	"ExitPlanMode",
	"KillShell",
	"NotebookEdit",
	"Skill",
	"Task",
	"TaskOutput",
	"TodoWrite",
	"WebFetch",
	"WebSearch",
];

const claudeCodeToolLookup = new Map(claudeCodeTools.map((tool) => [tool.toLowerCase(), tool]));

export function toClaudeCodeName(name: string): string {
	return claudeCodeToolLookup.get(name.toLowerCase()) ?? name;
}

export function fromClaudeCodeName(name: string, tools?: Tool[]): string {
	const matchedTool = tools?.find((tool) => tool.name.toLowerCase() === name.toLowerCase());
	return matchedTool?.name ?? name;
}

export function normalizeAnthropicToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export function convertTools(tools: Tool[], isOAuthToken: boolean): Anthropic.Messages.Tool[] {
	return tools.map((tool) => {
		const jsonSchema = tool.parameters as {
			properties?: Record<string, unknown>;
			required?: string[];
		};
		return {
			name: isOAuthToken ? toClaudeCodeName(tool.name) : tool.name,
			description: tool.description,
			input_schema: {
				type: "object",
				properties: jsonSchema.properties || {},
				required: jsonSchema.required || [],
			},
		};
	});
}
