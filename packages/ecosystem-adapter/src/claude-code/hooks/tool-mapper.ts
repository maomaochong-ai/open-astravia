import type { EcosystemToolDescriptor } from "../../hooks/runtime.js";
import type { HookToolIdentity } from "../../hooks/types.js";

/**
 * Map Astravia host tools to Claude Code canonical tool names used by matchers and stdin.
 * Team tools (TeamCreate / TeamDelete / SendMessage) are not hosted yet; when they appear as
 * custom tools with those names they pass through unchanged.
 */
export function mapToolToClaude(tool: EcosystemToolDescriptor): HookToolIdentity {
	if (tool.kind === "shell") return { name: "Bash", matcherAliases: ["bash", "shell"] };
	if (tool.kind === "agent" && (tool.hostName === "spawn_agent" || tool.hostName === "Agent")) {
		return { name: "Agent", matcherAliases: ["spawn_agent", "Task"] };
	}
	if (tool.kind === "mcp") return { name: mcpToolName(tool), matcherAliases: [] };
	if (tool.kind === "file-edit") {
		if (tool.hostName === "write") return { name: "Write", matcherAliases: ["write"] };
		if (tool.hostName === "edit") return { name: "Edit", matcherAliases: ["edit"] };
		return { name: tool.hostName, matcherAliases: [] };
	}
	if (tool.hostName === "read") return { name: "Read", matcherAliases: ["read"] };
	if (tool.hostName === "grep") return { name: "Grep", matcherAliases: ["grep"] };
	if (tool.hostName === "find" || tool.hostName === "glob") {
		return { name: "Glob", matcherAliases: ["find", "glob"] };
	}
	if (tool.hostName === "TeamCreate" || tool.hostName === "TeamDelete" || tool.hostName === "SendMessage") {
		return { name: tool.hostName, matcherAliases: [] };
	}
	return { name: tool.hostName, matcherAliases: [] };
}

function mcpToolName(tool: EcosystemToolDescriptor): string {
	const serverName = tool.source?.serverName;
	const originalName = tool.source?.originalName;
	if (serverName && originalName) return `mcp__${serverName}__${originalName}`;
	const legacyMatch = /^mcp_([^_]+)_(.+)$/.exec(tool.hostName);
	return legacyMatch ? `mcp__${legacyMatch[1]}__${legacyMatch[2]}` : tool.hostName;
}
