type RunApprovalListener = () => void;

let pendingRunIds: readonly string[] = [];
const listeners = new Set<RunApprovalListener>();

export function requestContentRunApproval(runId: string): void {
	if (pendingRunIds.includes(runId)) return;
	pendingRunIds = [...pendingRunIds, runId];
	emitRunApprovalChange();
}

export function resolveContentRunApproval(runId: string): void {
	const next = pendingRunIds.filter((candidate) => candidate !== runId);
	if (next.length === pendingRunIds.length) return;
	pendingRunIds = next;
	emitRunApprovalChange();
}

export function clearContentRunApprovals(): void {
	if (pendingRunIds.length === 0) return;
	pendingRunIds = [];
	emitRunApprovalChange();
}

export function getPendingContentRunIds(): readonly string[] {
	return pendingRunIds;
}

export function subscribeContentRunApprovals(listener: RunApprovalListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function emitRunApprovalChange(): void {
	for (const listener of listeners) listener();
}
