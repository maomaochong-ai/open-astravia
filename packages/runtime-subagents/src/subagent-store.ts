import type { SubagentSnapshot } from "./contracts.js";
import { cloneSnapshot, type SubagentEntry } from "./internal.js";

export class SubagentStore {
	private readonly children = new Map<string, SubagentEntry>();
	private readonly byTaskName = new Map<string, string>();

	get size(): number {
		return this.children.size;
	}

	list(): readonly SubagentSnapshot[] {
		return [...this.children.values()]
			.map((entry) => cloneSnapshot(entry.snapshot))
			.sort((left, right) => left.startedAt - right.startedAt);
	}

	values(): readonly SubagentEntry[] {
		return [...this.children.values()];
	}

	entries(): readonly (readonly [string, SubagentEntry])[] {
		return [...this.children.entries()];
	}

	getById(id: string): SubagentEntry | undefined {
		return this.children.get(id);
	}

	resolve(target: string): SubagentEntry | undefined {
		const direct = this.children.get(target);
		if (direct) return direct;
		const taskName = target.startsWith("/root/") ? target.slice("/root/".length) : target;
		const id = this.byTaskName.get(taskName);
		return id ? this.children.get(id) : undefined;
	}

	hasTaskName(taskName: string): boolean {
		return this.byTaskName.has(taskName);
	}

	add(entry: SubagentEntry): void {
		this.children.set(entry.snapshot.id, entry);
		this.byTaskName.set(entry.snapshot.taskName, entry.snapshot.id);
	}

	rekey(entry: SubagentEntry, previousId: string): void {
		this.children.delete(previousId);
		this.children.set(entry.snapshot.id, entry);
		this.byTaskName.set(entry.snapshot.taskName, entry.snapshot.id);
	}

	remove(id: string): SubagentEntry | undefined {
		const entry = this.children.get(id);
		if (!entry) return undefined;
		this.children.delete(id);
		this.byTaskName.delete(entry.snapshot.taskName);
		return entry;
	}
}
