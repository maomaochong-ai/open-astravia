import { isValidTaskName, type SubagentRecoveryState, type SubagentSnapshot, taskPath } from "./contracts.js";
import { cloneSnapshot, isTerminalStatus } from "./snapshot.js";

export function normalizeSubagentRecoveryState(
	state: SubagentRecoveryState,
	parentSessionId: string,
	now: number,
): readonly SubagentSnapshot[] {
	const ids = new Set<string>();
	const taskNames = new Set<string>();
	return state.agents.map((source) => {
		if (ids.has(source.id)) throw new Error(`Duplicate recovered subagent id "${source.id}"`);
		if (taskNames.has(source.taskName)) {
			throw new Error(`Duplicate recovered subagent task_name "${source.taskName}"`);
		}
		if (source.parentSessionId !== parentSessionId) {
			throw new Error(
				`Recovered subagent "${source.id}" belongs to parent "${source.parentSessionId}", not "${parentSessionId}"`,
			);
		}
		if (!isValidTaskName(source.taskName) || source.path !== taskPath(source.taskName)) {
			throw new Error(`Recovered subagent "${source.id}" has an invalid task identity`);
		}
		ids.add(source.id);
		taskNames.add(source.taskName);
		const snapshot = cloneSnapshot(source);
		if (isTerminalStatus(snapshot.status)) return snapshot;
		return {
			...snapshot,
			status: snapshot.sessionFile ? "interrupted" : "failed",
			endedAt: now,
			generation: snapshot.generation + 1,
			errorMessage: snapshot.sessionFile
				? "Parent runtime restarted while the subagent was active"
				: "Parent runtime restarted before the child session was created",
		};
	});
}
