export class SubagentScheduler {
	private readonly active = new Set<string>();
	private readonly queue: string[] = [];

	constructor(readonly maxConcurrent: number) {
		if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
			throw new Error("Subagent maxConcurrent must be a positive integer");
		}
	}

	get activeCount(): number {
		return this.active.size;
	}

	get hasCapacity(): boolean {
		return this.active.size < this.maxConcurrent;
	}

	acquire(id: string): boolean {
		if (!this.hasCapacity) return false;
		this.active.add(id);
		return true;
	}

	enqueue(id: string): void {
		this.queue.push(id);
	}

	takeNext(): string | undefined {
		if (!this.hasCapacity) return undefined;
		const id = this.queue.shift();
		if (id) this.active.add(id);
		return id;
	}

	rekey(previousId: string, nextId: string): void {
		if (!this.active.delete(previousId)) return;
		this.active.add(nextId);
	}

	release(id: string): void {
		this.active.delete(id);
	}

	removeQueued(id: string): void {
		const index = this.queue.indexOf(id);
		if (index >= 0) this.queue.splice(index, 1);
	}

	clear(): void {
		this.active.clear();
		this.queue.length = 0;
	}
}
