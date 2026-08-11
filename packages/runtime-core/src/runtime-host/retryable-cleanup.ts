export interface RetryableCleanupTask {
	readonly id: string;
	readonly phase?: number;
	readonly cleanup: () => Promise<void> | void;
}

/**
 * Closes admission immediately while retaining failed resource cleanup for a later retry.
 * Tasks in one phase run together; later phases still run when an earlier phase fails.
 */
export class RetryableCleanup {
	private readonly pending = new Map<string, RetryableCleanupTask>();
	private operation: Promise<void> | undefined;

	add(task: RetryableCleanupTask): void {
		if (this.pending.has(task.id)) throw new Error(`Cleanup task is already registered: ${task.id}`);
		this.pending.set(task.id, task);
	}

	run(message: string): Promise<void> {
		if (this.operation) return this.operation;
		if (this.pending.size === 0) return Promise.resolve();

		const operation = this.runPending(message);
		const tracked = operation.then(
			() => {
				if (this.operation === tracked) this.operation = undefined;
			},
			(error: unknown) => {
				if (this.operation === tracked) this.operation = undefined;
				throw error;
			},
		);
		this.operation = tracked;
		return tracked;
	}

	private async runPending(message: string): Promise<void> {
		const tasks = [...this.pending.values()];
		const phases = [...new Set(tasks.map((task) => task.phase ?? 0))].sort((left, right) => left - right);
		const errors: unknown[] = [];

		for (const phase of phases) {
			const phaseTasks = tasks.filter((task) => (task.phase ?? 0) === phase);
			const results = await Promise.allSettled(
				phaseTasks.map((task) => Promise.resolve().then(() => task.cleanup())),
			);
			for (const [index, result] of results.entries()) {
				const task = phaseTasks[index];
				if (!task) continue;
				if (result.status === "fulfilled") {
					if (this.pending.get(task.id) === task) this.pending.delete(task.id);
				} else {
					errors.push(result.reason);
				}
			}
		}

		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, message);
	}
}
