import type { ConversationScenario, ToolActivationMetadata } from "./contracts.js";

export function matchesAgentMode(declared: readonly string[] | undefined, mode: string | undefined): boolean {
	if (mode === undefined || !declared || declared.length === 0) return true;
	return declared.includes(mode);
}

export function resolveActiveToolNames(
	scenario: ConversationScenario,
	tools: readonly ToolActivationMetadata[],
	capabilities: ReadonlySet<string>,
	mode?: string,
): string[] {
	const active: string[] = [];
	for (const tool of tools) {
		if (!tool.scope_use || !tool.scope_use.includes(scenario)) continue;
		if (tool.requires && !tool.requires.every((capability) => capabilities.has(capability))) continue;
		if (!matchesAgentMode(tool.agent_mode, mode)) continue;
		active.push(tool.name);
	}
	return active;
}
