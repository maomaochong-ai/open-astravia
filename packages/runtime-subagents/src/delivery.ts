import type { SubagentDeliveryMarker, SubagentSnapshot } from "./contracts.js";
import { clipFinalText } from "./contracts.js";
import { SubagentDeliveryTracker } from "./delivery-tracker.js";
import { cloneSnapshot, isTerminalStatus } from "./internal.js";

export interface SubagentDeliveryOptions {
	readonly notificationDelayMs: number;
	readonly onNotify?: (agents: readonly SubagentSnapshot[]) => void;
	readonly onDeliveryClaimed?: (marker: SubagentDeliveryMarker) => void;
}

export class SubagentDelivery {
	private readonly tracker = new SubagentDeliveryTracker();
	private readonly waiters = new Set<() => void>();
	private notifyBuffer: SubagentSnapshot[] = [];
	private notifyTimer?: ReturnType<typeof setTimeout>;
	private notificationsClosed = false;

	constructor(private readonly options: SubagentDeliveryOptions) {}

	restore(markers: readonly SubagentDeliveryMarker[]): void {
		this.tracker.restore(markers);
	}

	hasUndelivered(snapshot: SubagentSnapshot): boolean {
		return isTerminalStatus(snapshot.status) && !this.tracker.isDelivered(snapshot.id, snapshot.generation);
	}

	claim(snapshot: SubagentSnapshot): SubagentSnapshot | undefined {
		if (!this.tracker.tryClaim(snapshot.id, snapshot.generation)) return undefined;
		this.options.onDeliveryClaimed?.({ id: snapshot.id, generation: snapshot.generation });
		return {
			...cloneSnapshot(snapshot),
			finalText: clipFinalText(snapshot.finalText),
		};
	}

	queue(snapshot: SubagentSnapshot): void {
		if (this.notificationsClosed || !this.options.onNotify) return;
		if (!this.hasUndelivered(snapshot)) return;
		this.notifyBuffer.push(cloneSnapshot(snapshot));
		if (this.notifyTimer) return;
		this.notifyTimer = setTimeout(() => {
			this.notifyTimer = undefined;
			this.flush();
		}, this.options.notificationDelayMs);
	}

	subscribe(waiter: () => void): () => void {
		this.waiters.add(waiter);
		return () => this.waiters.delete(waiter);
	}

	wake(): void {
		for (const waiter of [...this.waiters]) waiter();
	}

	closeNotifications(): void {
		this.notificationsClosed = true;
		if (this.notifyTimer) clearTimeout(this.notifyTimer);
		this.notifyTimer = undefined;
		this.notifyBuffer = [];
	}

	clearWaiters(): void {
		this.waiters.clear();
	}

	private flush(): void {
		const notify = this.options.onNotify;
		if (this.notificationsClosed || !notify) {
			this.notifyBuffer = [];
			return;
		}
		const batch = this.notifyBuffer.flatMap((snapshot) => {
			const claimed = this.claim(snapshot);
			return claimed ? [claimed] : [];
		});
		this.notifyBuffer = [];
		if (batch.length > 0) notify(batch);
	}
}
