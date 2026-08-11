export const SPAWN_AGENT_TOOL_DESCRIPTION = [
	"Spawn a background subagent (independent session) to gather information or do specialized work.",
	"Returns immediately with id/path/status; use wait_agent or wait for <subagent_notification>.",
	"Does not block the root agent. Multiple explorers may run in parallel (concurrency limit applies).",
	"",
	"Agent types are registry-based; currently registered types are listed at runtime via list_agents / this tool's errors.",
	"Typical first type: explorer — read-only recon + parent MCP search; never edits files. Root agent applies changes.",
].join("\n");
