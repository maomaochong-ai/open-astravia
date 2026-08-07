import type { SubagentSnapshot, SubagentSpawnRequest, SubagentTypeDefinition } from "../../src/index.js";

export interface TestProfile {
	readonly kind: "explorer" | "workflow";
}

export function request(taskName: string, agentType = "explorer"): SubagentSpawnRequest {
	return { taskName, agentType, message: `work on ${taskName}` };
}

export function snapshot(
	id: string,
	status: SubagentSnapshot["status"],
	overrides: Partial<SubagentSnapshot> = {},
): SubagentSnapshot {
	const taskName = overrides.taskName ?? id;
	return {
		id,
		taskName,
		path: `/root/${taskName}`,
		agentType: "explorer",
		status,
		task: `work on ${taskName}`,
		parentSessionId: "root-session",
		startedAt: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 },
		generation: 0,
		...overrides,
	};
}

export function typeDefinition(kind: TestProfile["kind"]): SubagentTypeDefinition<TestProfile> {
	return {
		id: kind,
		label: kind,
		description: `${kind} agent`,
		profile: { kind },
	};
}
