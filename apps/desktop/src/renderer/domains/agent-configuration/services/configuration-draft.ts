import type { AgentConfiguration, AgentConfigurationSelection } from "@vetta/coding-agent/profile";
import { DEFAULT_AGENT_CONFIGURATION } from "@vetta/coding-agent/profile";

export function editAgentConfiguration(selection: AgentConfigurationSelection): AgentConfiguration {
	return { ...DEFAULT_AGENT_CONFIGURATION, ...selection.template?.configuration, ...selection.overrides };
}

export function parseResourceIds(text: string): string[] {
	return [
		...new Set(
			text
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean),
		),
	];
}
