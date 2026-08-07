import type { SubagentChildHandle, SubagentSnapshot, SubagentSpawnRequest, SubagentStatus } from "./contracts.js";

export type MutableSubagentSnapshot = {
	-readonly [K in keyof SubagentSnapshot]: SubagentSnapshot[K];
};

export interface SubagentEntry {
	snapshot: MutableSubagentSnapshot;
	handle?: SubagentChildHandle;
	unsubscribe?: () => void;
	todoUnsubscribe?: () => void;
	queuedRequest?: SubagentSpawnRequest;
	startLifecycleCompleted: boolean;
	stopContinuationCount: number;
	endInFlight: boolean;
}

export function cloneSnapshot(snapshot: SubagentSnapshot): SubagentSnapshot {
	return {
		...snapshot,
		usage: { ...snapshot.usage },
		todoProgress: snapshot.todoProgress ? { ...snapshot.todoProgress } : undefined,
	};
}

export function isActiveStatus(status: SubagentStatus): boolean {
	return status === "pending" || status === "running";
}

export function isTerminalStatus(status: SubagentStatus): boolean {
	return status === "completed" || status === "failed" || status === "interrupted";
}
