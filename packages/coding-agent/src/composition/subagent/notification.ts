import { clipFinalText, type SubagentSnapshot } from "@vetta/runtime-subagents";

export interface SubagentNotificationPayload {
	readonly agents: readonly SubagentSnapshot[];
	readonly text: string;
}

export function buildSubagentNotification(agents: readonly SubagentSnapshot[]): SubagentNotificationPayload {
	const lines = ["<subagent_notification>"];
	for (const agent of agents) {
		lines.push(`id: ${agent.id}`);
		lines.push(`path: ${agent.path}`);
		lines.push(`type: ${agent.agentType}`);
		lines.push(`task_name: ${agent.taskName}`);
		if (agent.title) lines.push(`title: ${agent.title}`);
		lines.push(`status: ${agent.status}`);
		if (agent.status === "interrupted") {
			lines.push(
				"hint: resumable — use followup_task to continue this child with its context and todo progress intact; do NOT re-dispatch it as a new workflow",
			);
		}
		if (agent.errorMessage) lines.push(`error: ${agent.errorMessage}`);
		const finalText = clipFinalText(agent.finalText);
		if (finalText) lines.push("summary:", finalText);
		if (agent.sessionFile) lines.push(`session_file: ${agent.sessionFile}`);
		lines.push("---");
	}
	lines.push("</subagent_notification>");
	return { agents: [...agents], text: lines.join("\n") };
}
