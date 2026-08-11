export interface InitializationRollbackTask {
	readonly id: string;
	readonly rollback: () => Promise<void> | void;
}

/**
 * Owns resources only while an object graph is being initialized.
 *
 * Rollback is one-shot and strictly reverse ordered. Once committed, ownership
 * belongs to the initialized object and this scope no longer retains cleanup.
 */
export class InitializationRollbackScope {
	private readonly tasks: Array<InitializationRollbackTask & { active: boolean }> = [];
	private finished = false;

	defer(task: InitializationRollbackTask): () => void {
		if (this.finished) throw new Error("Initialization rollback scope is already finished");
		if (this.tasks.some((registered) => registered.id === task.id)) {
			throw new Error(`Initialization rollback task is already registered: ${task.id}`);
		}
		const registered = { ...task, active: true };
		this.tasks.push(registered);
		return () => {
			registered.active = false;
		};
	}

	commit(): void {
		if (this.finished) throw new Error("Initialization rollback scope is already finished");
		this.finished = true;
		this.tasks.length = 0;
	}

	async rollback(cause: unknown, message: string): Promise<never> {
		if (this.finished) throw new Error("Initialization rollback scope is already finished");
		this.finished = true;
		const errors: unknown[] = [];
		for (const task of this.tasks.reverse()) {
			if (!task.active) continue;
			try {
				await task.rollback();
			} catch (error) {
				errors.push(error);
			}
		}
		this.tasks.length = 0;
		if (errors.length === 0) throw cause;
		throw new AggregateError([cause, ...errors], message, { cause });
	}
}
