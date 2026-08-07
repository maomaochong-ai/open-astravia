import type { SubagentSnapshot, SubagentStatus } from "./contracts.js";

export type MutableSubagentSnapshot = {
	-readonly [K in keyof SubagentSnapshot]: SubagentSnapshot[K];
};

export function cloneSnapshot(snapshot: SubagentSnapshot): SubagentSnapshot {
	return {
		...snapshot,
		usage: { ...snapshot.usage },
		todoProgress: snapshot.todoProgress ? { ...snapshot.todoProgress } : undefined,
	};
}

export function mutableSnapshot(snapshot: SubagentSnapshot): MutableSubagentSnapshot {
	return cloneSnapshot(snapshot);
}

export function isActiveStatus(status: SubagentStatus): boolean {
	return status === "pending" || status === "running";
}

export function isTerminalStatus(status: SubagentStatus): boolean {
	return status === "completed" || status === "failed" || status === "interrupted";
}
