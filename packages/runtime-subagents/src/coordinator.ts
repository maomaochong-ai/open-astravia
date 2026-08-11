import type {
	SubagentCoordinatorOptions,
	SubagentCoordinatorPort,
	SubagentRecoveryState,
	SubagentSnapshot,
	SubagentSpawnRequest,
	SubagentTypeId,
	SubagentWaitOptions,
	SubagentWaitResult,
} from "./contracts.js";
import { SubagentDelivery } from "./delivery.js";
import { SubagentDispatcher } from "./subagent-dispatcher.js";

const DEFAULT_NOTIFICATION_DELAY_MS = 50;

export class SubagentCoordinator<TProfile = unknown> implements SubagentCoordinatorPort {
	private readonly delivery: SubagentDelivery;
	private readonly dispatcher: SubagentDispatcher<TProfile>;
	private disposed = false;
	private disposePromise: Promise<void> | undefined;

	constructor(options: SubagentCoordinatorOptions<TProfile>) {
		this.delivery = new SubagentDelivery({
			notificationDelayMs: options.notificationDelayMs ?? DEFAULT_NOTIFICATION_DELAY_MS,
			onNotify: options.onNotify,
			onDeliveryClaimed: options.onDeliveryClaimed,
			onError: options.onError,
		});
		this.dispatcher = new SubagentDispatcher({
			...options,
			onTerminal: (snapshot) => {
				this.delivery.wake();
				this.delivery.queue(snapshot);
			},
		});
	}

	list(): readonly SubagentSnapshot[] {
		return this.dispatcher.list();
	}

	get(target: string): SubagentSnapshot | undefined {
		return this.dispatcher.get(target);
	}

	restore(state: SubagentRecoveryState): readonly SubagentSnapshot[] {
		this.assertNotDisposed();
		const restored = this.dispatcher.restore(state);
		this.delivery.restore(state.delivered);
		return restored;
	}

	registeredTypeIds(): readonly SubagentTypeId[] {
		return this.dispatcher.registeredTypeIds();
	}

	clearFinished(): number {
		return this.dispatcher.clearFinished();
	}

	spawn(request: SubagentSpawnRequest): Promise<SubagentSnapshot> {
		return this.dispatcher.spawn(request);
	}

	spawnMany(requests: readonly SubagentSpawnRequest[]): readonly SubagentSnapshot[] {
		return this.dispatcher.spawnMany(requests);
	}

	sendMessage(target: string, message: string): Promise<SubagentSnapshot> {
		return this.dispatcher.sendMessage(target, message);
	}

	followUp(target: string, message: string): Promise<SubagentSnapshot> {
		return this.dispatcher.followUp(target, message);
	}

	interrupt(target: string): SubagentSnapshot {
		return this.dispatcher.interrupt(target);
	}

	async wait(options: SubagentWaitOptions = {}): Promise<SubagentWaitResult> {
		this.assertNotDisposed();
		return await this.delivery.wait(options, (targets) => this.dispatcher.resolveTargets(targets));
	}

	dispose(): Promise<void> {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.delivery.closeNotifications();
		this.disposePromise = this.performDispose();
		return this.disposePromise;
	}

	private async performDispose(): Promise<void> {
		await this.dispatcher.dispose();
		this.delivery.clearWaiters();
	}

	private assertNotDisposed(): void {
		if (this.disposed) throw new Error("SubagentCoordinator is disposed");
	}
}
