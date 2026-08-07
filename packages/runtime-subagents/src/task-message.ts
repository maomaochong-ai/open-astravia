import type { SubagentSnapshot } from "./contracts.js";

export function formatDefaultSubagentTaskMessage(snapshot: SubagentSnapshot, message: string): string {
	return [
		"<subagent_task>",
		`id: ${snapshot.id}`,
		`path: ${snapshot.path}`,
		`type: ${snapshot.agentType}`,
		`task_name: ${snapshot.taskName}`,
		"</subagent_task>",
		"",
		message,
	].join("\n");
}
