export interface RuntimeSessionValueIndex<T> {
	get(sessionId: string): T | undefined;
	set(sessionId: string, value: T): void;
	unbind(sessionId: string, value: T): void;
	rebind(previousSessionId: string, nextSessionId: string, value: T): void;
	delete(sessionId: string): boolean;
	entries(): IterableIterator<[string, T]>;
	values(): IterableIterator<T>;
	clear(): void;
}

/** Maintains resource identity while a Runtime Session ID changes. */
export class InMemoryRuntimeSessionValueIndex<T> implements RuntimeSessionValueIndex<T> {
	private readonly valuesBySessionId = new Map<string, T>();

	get(sessionId: string): T | undefined {
		return this.valuesBySessionId.get(sessionId);
	}

	set(sessionId: string, value: T): void {
		this.valuesBySessionId.set(sessionId, value);
	}

	unbind(sessionId: string, value: T): void {
		if (this.valuesBySessionId.get(sessionId) === value) this.valuesBySessionId.delete(sessionId);
	}

	rebind(previousSessionId: string, nextSessionId: string, value: T): void {
		if (this.valuesBySessionId.get(previousSessionId) !== value) return;
		this.valuesBySessionId.delete(previousSessionId);
		this.valuesBySessionId.set(nextSessionId, value);
	}

	delete(sessionId: string): boolean {
		return this.valuesBySessionId.delete(sessionId);
	}

	entries(): IterableIterator<[string, T]> {
		return this.valuesBySessionId.entries();
	}

	values(): IterableIterator<T> {
		return this.valuesBySessionId.values();
	}

	clear(): void {
		this.valuesBySessionId.clear();
	}
}

export interface RuntimeSessionMarkerIndex {
	has(sessionId: string): boolean;
	add(sessionId: string): void;
	delete(sessionId: string): boolean;
	rebind(previousSessionId: string, nextSessionId: string): void;
	clear(): void;
}

/** Tracks a boolean marker across Runtime Session identity changes. */
export class InMemoryRuntimeSessionMarkerIndex implements RuntimeSessionMarkerIndex {
	private readonly sessionIds = new Set<string>();

	has(sessionId: string): boolean {
		return this.sessionIds.has(sessionId);
	}

	add(sessionId: string): void {
		this.sessionIds.add(sessionId);
	}

	delete(sessionId: string): boolean {
		return this.sessionIds.delete(sessionId);
	}

	rebind(previousSessionId: string, nextSessionId: string): void {
		if (!this.sessionIds.delete(previousSessionId)) return;
		this.sessionIds.add(nextSessionId);
	}

	clear(): void {
		this.sessionIds.clear();
	}
}
