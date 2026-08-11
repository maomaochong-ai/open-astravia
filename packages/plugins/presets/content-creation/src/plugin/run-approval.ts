type RunApprovalListener = () => void;

export class ContentRunApprovalStore {
	private pendingRunIds: readonly string[] = [];
	private readonly listeners = new Set<RunApprovalListener>();

	request = (runId: string): void => {
		if (this.pendingRunIds.includes(runId)) return;
		this.pendingRunIds = [...this.pendingRunIds, runId];
		this.emitChange();
	};

	resolve = (runId: string): void => {
		const next = this.pendingRunIds.filter((candidate) => candidate !== runId);
		if (next.length === this.pendingRunIds.length) return;
		this.pendingRunIds = next;
		this.emitChange();
	};

	clear = (): void => {
		if (this.pendingRunIds.length === 0) return;
		this.pendingRunIds = [];
		this.emitChange();
	};

	getSnapshot = (): readonly string[] => this.pendingRunIds;

	subscribe = (listener: RunApprovalListener): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	private emitChange(): void {
		for (const listener of this.listeners) listener();
	}
}
