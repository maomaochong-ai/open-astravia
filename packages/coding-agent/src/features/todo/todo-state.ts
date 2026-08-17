import type { TodoItem, TodoLockSource, TodoSnapshot, TodoSnapshotEnvelope, TodoUpdateListener } from "./contracts.js";

export class TodoState {
	private items: TodoItem[] = [];
	private nextId = 1;
	private lockedBy: TodoLockSource | null = null;
	private readonly listeners = new Set<TodoUpdateListener>();
	private persistFn?: (snapshot: TodoSnapshotEnvelope) => void;

	constructor(persistFn?: (snapshot: TodoSnapshotEnvelope) => void) {
		this.persistFn = persistFn;
	}

	setPersistFn(fn: (snapshot: TodoSnapshotEnvelope) => void): void {
		this.persistFn = fn;
	}

	getAll(): ReadonlyArray<TodoItem> {
		return this.items;
	}

	get(id: number): TodoItem | undefined {
		return this.items.find((item) => item.id === id);
	}

	isLocked(): boolean {
		return this.lockedBy !== null;
	}

	getLockSource(): TodoLockSource | null {
		return this.lockedBy;
	}

	createMany(contents: string[]): TodoItem[] {
		const created = contents.map((content) => ({ id: this.nextId++, content, status: "pending" as const }));
		this.items.push(...created);
		this.afterMutation();
		return created;
	}

	update(id: number, status: TodoItem["status"]): TodoItem | undefined {
		const item = this.items.find((candidate) => candidate.id === id);
		if (!item) return undefined;
		item.status = status;
		this.afterMutation();
		return item;
	}

	clear(): void {
		this.items = [];
		this.nextId = 1;
		this.lockedBy = null;
		this.afterMutation();
	}

	lock(source: TodoLockSource): void {
		if (this.lockedBy === source) return;
		this.lockedBy = source;
		this.afterMutation();
	}

	restoreFromSnapshot(snapshot: TodoSnapshot): void {
		const items = Array.isArray(snapshot) ? snapshot : snapshot.items;
		this.items = items.map((item) => ({ ...item }));
		this.nextId = this.items.length > 0 ? Math.max(...this.items.map((item) => item.id)) + 1 : 1;
		this.lockedBy = Array.isArray(snapshot) ? null : (snapshot.lockedBy ?? null);
		this.notify();
	}

	subscribe(listener: TodoUpdateListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private afterMutation(): void {
		this.persistFn?.({
			items: this.items.map((item) => ({ ...item })),
			lockedBy: this.lockedBy,
		});
		this.notify();
	}

	private notify(): void {
		for (const listener of this.listeners) {
			try {
				listener(this.items);
			} catch {
				// Listener failures must not alter work-state mutations.
			}
		}
	}
}
