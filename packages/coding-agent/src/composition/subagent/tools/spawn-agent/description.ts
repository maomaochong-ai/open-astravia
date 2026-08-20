export const SPAWN_AGENT_TOOL_DESCRIPTION = [
	"Spawn one costly background subagent for a complex, well-bounded task that is independent of the root's remaining work.",
	"Returns immediately with id/path/status; use wait_agent or wait for <subagent_notification>.",
	"Do not use for simple work, ambiguous requests, or a task the root can complete directly with a few tool calls.",
	"Use the structured task contract. Include relevant history, verified current state, one objective, exact scope, constraints, context, deliverables, and functional validation.",
	"",
	"Agent types are registry-based; currently registered types are listed at runtime via list_agents / this tool's errors.",
	"Default type: general — inherits the parent's tools, MCP tools, skills, and context. Use explorer only for read-only local reconnaissance.",
].join("\n");
