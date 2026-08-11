import type { SubagentSnapshot } from "./contracts.js";
import { isTerminalStatus } from "./snapshot.js";
import type { SubagentRun } from "./subagent-run.js";

export class SubagentPool<TProfile> {
	private readonly runs = new Map<string, SubagentRun<TProfile>>();
	private readonly byTaskName = new Map<string, string>();
	private readonly active = new Set<string>();
	private readonly queue: string[] = [];

	constructor(readonly maxConcurrent: number) {
		if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
			throw new Error("Subagent maxConcurrent must be a positive integer");
		}
	}

	get size(): number {
		return this.runs.size;
	}

	get activeCount(): number {
		return this.active.size;
	}

	get hasCapacity(): boolean {
		return this.active.size < this.maxConcurrent;
	}

	list(): readonly SubagentSnapshot[] {
		return [...this.runs.values()]
			.map((run) => run.readSnapshot())
			.sort((left, right) => left.startedAt - right.startedAt);
	}

	values(): readonly SubagentRun<TProfile>[] {
		return [...this.runs.values()];
	}

	resolve(target: string): SubagentRun<TProfile> | undefined {
		const direct = this.runs.get(target);
		if (direct) return direct;
		const taskName = target.startsWith("/root/") ? target.slice("/root/".length) : target;
		const id = this.byTaskName.get(taskName);
		return id ? this.runs.get(id) : undefined;
	}

	hasTaskName(taskName: string): boolean {
		return this.byTaskName.has(taskName);
	}

	add(run: SubagentRun<TProfile>): void {
		if (this.runs.has(run.id)) throw new Error(`Subagent id "${run.id}" is already registered`);
		if (this.byTaskName.has(run.taskName)) {
			throw new Error(`task_name "${run.taskName}" is already used in this session`);
		}
		this.runs.set(run.id, run);
		this.byTaskName.set(run.taskName, run.id);
	}

	rekey(run: SubagentRun<TProfile>, previousId: string, nextId: string): void {
		if (previousId === nextId) return;
		const collision = this.runs.get(nextId);
		if (collision && collision !== run) throw new Error(`Subagent id "${nextId}" is already registered`);
		if (this.runs.get(previousId) !== run) {
			throw new Error(`Subagent id "${previousId}" is not owned by task "${run.taskName}"`);
		}
		this.runs.delete(previousId);
		this.runs.set(nextId, run);
		this.byTaskName.set(run.taskName, nextId);
		if (this.active.delete(previousId)) this.active.add(nextId);
		const queuedIndex = this.queue.indexOf(previousId);
		if (queuedIndex >= 0) this.queue[queuedIndex] = nextId;
	}

	acquire(run: SubagentRun<TProfile>): boolean {
		if (!this.hasCapacity || this.active.has(run.id)) return false;
		this.active.add(run.id);
		return true;
	}

	isActive(run: SubagentRun<TProfile>): boolean {
		return this.active.has(run.id);
	}

	enqueue(run: SubagentRun<TProfile>): void {
		if (!this.queue.includes(run.id)) this.queue.push(run.id);
	}

	takeNext(): SubagentRun<TProfile> | undefined {
		if (!this.hasCapacity) return undefined;
		while (this.queue.length > 0) {
			const id = this.queue.shift();
			if (!id) continue;
			const run = this.runs.get(id);
			if (!run || run.status !== "queued") continue;
			this.active.add(id);
			return run;
		}
		return undefined;
	}

	release(run: SubagentRun<TProfile>): void {
		this.active.delete(run.id);
	}

	removeQueued(run: SubagentRun<TProfile>): void {
		const index = this.queue.indexOf(run.id);
		if (index >= 0) this.queue.splice(index, 1);
	}

	remove(run: SubagentRun<TProfile>): boolean {
		if (this.runs.get(run.id) !== run) return false;
		this.removeQueued(run);
		this.active.delete(run.id);
		this.runs.delete(run.id);
		this.byTaskName.delete(run.taskName);
		return true;
	}

	removeFinished(predicate: (snapshot: SubagentSnapshot) => boolean = () => true): readonly SubagentRun<TProfile>[] {
		const removed: SubagentRun<TProfile>[] = [];
		for (const run of this.runs.values()) {
			const snapshot = run.readSnapshot();
			if (!isTerminalStatus(snapshot.status) || !predicate(snapshot)) continue;
			if (this.remove(run)) removed.push(run);
		}
		return removed;
	}

	clearScheduling(): void {
		this.active.clear();
		this.queue.length = 0;
	}
}
