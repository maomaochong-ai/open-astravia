export interface RuntimeOwnershipLease {
	release(): Promise<void>;
}

export interface RuntimeOwnershipManager<TTarget> {
	acquire(target: TTarget): Promise<RuntimeOwnershipLease>;
}

/**
 * Keeps exclusive ownership attached to a mutable Runtime identity.
 *
 * Rebinding acquires the target before releasing the source. If source release
 * fails, the target is released and the original ownership remains active.
 */
export class RuntimeOwnershipBinding<TTarget> {
	private disposed = false;
	private disposeOperation: Promise<void> | undefined;

	private constructor(
		private readonly manager: RuntimeOwnershipManager<TTarget>,
		private lease: RuntimeOwnershipLease,
		private currentTarget: TTarget,
	) {}

	static async acquire<TTarget>(
		manager: RuntimeOwnershipManager<TTarget>,
		target: TTarget,
	): Promise<RuntimeOwnershipBinding<TTarget>> {
		return new RuntimeOwnershipBinding(manager, await manager.acquire(target), target);
	}

	get target(): TTarget {
		return this.currentTarget;
	}

	async rebind(target: TTarget): Promise<void> {
		if (this.disposed) throw new Error("Runtime ownership binding is disposed");
		const previous = this.lease;
		const next = await this.manager.acquire(target);
		try {
			await previous.release();
		} catch (error) {
			try {
				await next.release();
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "Failed to release source and target ownership");
			}
			throw error;
		}
		this.lease = next;
		this.currentTarget = target;
	}

	dispose(): Promise<void> {
		if (this.disposed) return Promise.resolve();
		if (!this.disposeOperation) this.disposeOperation = this.release();
		return this.disposeOperation;
	}

	private async release(): Promise<void> {
		try {
			await this.lease.release();
			this.disposed = true;
		} finally {
			this.disposeOperation = undefined;
		}
	}
}
