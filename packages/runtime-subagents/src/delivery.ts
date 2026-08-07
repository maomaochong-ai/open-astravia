import type { SubagentDeliveryMarker, SubagentSnapshot, SubagentWaitOptions, SubagentWaitResult } from "./contracts.js";
import { clipFinalText } from "./contracts.js";
import { SubagentDeliveryTracker } from "./delivery-tracker.js";
import { cloneSnapshot, isTerminalStatus } from "./snapshot.js";

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const MIN_WAIT_TIMEOUT_MS = 1_000;
const MAX_WAIT_TIMEOUT_MS = 300_000;

export interface SubagentDeliveryOptions {
	readonly notificationDelayMs: number;
	readonly onNotify?: (agents: readonly SubagentSnapshot[]) => void;
	readonly onDeliveryClaimed?: (marker: SubagentDeliveryMarker) => void;
	readonly onError?: (error: unknown, operation: string) => void;
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
		this.safeCallback(
			() => this.options.onDeliveryClaimed?.({ id: snapshot.id, generation: snapshot.generation }),
			"persist subagent delivery claim",
		);
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
		for (const waiter of [...this.waiters]) this.safeCallback(waiter, "wake subagent waiter");
	}

	wait(
		options: SubagentWaitOptions,
		resolveTargets: (targets: readonly string[] | undefined) => readonly SubagentSnapshot[],
	): Promise<SubagentWaitResult> {
		const timeoutMs = clamp(options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS, MIN_WAIT_TIMEOUT_MS, MAX_WAIT_TIMEOUT_MS);
		const collectReady = (): SubagentSnapshot[] => {
			const ready: SubagentSnapshot[] = [];
			for (const snapshot of resolveTargets(options.targets)) {
				if (!isTerminalStatus(snapshot.status)) continue;
				const claimed = this.claim(snapshot);
				if (claimed) ready.push(claimed);
			}
			return ready;
		};
		const immediate = collectReady();
		if (immediate.length > 0) return Promise.resolve({ timedOut: false, agents: immediate });
		const active = resolveTargets(options.targets).filter((snapshot) => !isTerminalStatus(snapshot.status));
		if (active.length === 0) return Promise.resolve({ timedOut: false, agents: [] });

		return new Promise((resolve) => {
			let settled = false;
			let timer: ReturnType<typeof setTimeout>;
			let unsubscribe = () => {};
			const finish = (timedOut: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				unsubscribe();
				resolve({ timedOut, agents: collectReady() });
			};
			const onWake = () => {
				const ready = resolveTargets(options.targets).some(
					(snapshot) => isTerminalStatus(snapshot.status) && this.hasUndelivered(snapshot),
				);
				if (ready) finish(false);
			};
			unsubscribe = this.subscribe(onWake);
			timer = setTimeout(() => finish(true), timeoutMs);
		});
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
		if (batch.length > 0) this.safeCallback(() => notify(batch), "publish subagent notification");
	}

	private safeCallback(callback: () => void, operation: string): void {
		try {
			callback();
		} catch (error) {
			try {
				this.options.onError?.(error, operation);
			} catch {
				// Error observers cannot change delivery state.
			}
		}
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
