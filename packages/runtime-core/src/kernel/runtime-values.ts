import type { InstructionBlock, RuntimeToolDefinition } from "./contracts.js";

export function freezeInstruction(instruction: InstructionBlock): InstructionBlock {
	return Object.freeze({ ...instruction });
}

export function freezeTool(tool: RuntimeToolDefinition): RuntimeToolDefinition {
	return Object.freeze({
		...tool,
		inputSchema: freezeJsonObject(tool.inputSchema),
	});
}

function freezeJsonObject(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	const copy: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		copy[key] = freezeJsonValue(entry);
	}
	return Object.freeze(copy);
}

function freezeJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return Object.freeze(value.map(freezeJsonValue));
	}
	if (value !== null && typeof value === "object") {
		return freezeJsonObject(value as Readonly<Record<string, unknown>>);
	}
	return value;
}

export class ImmutableReadonlyMap<K, V> implements ReadonlyMap<K, V> {
	private readonly valuesByKey: Map<K, V>;

	constructor(entries: readonly (readonly [K, V])[]) {
		this.valuesByKey = new Map(entries);
		Object.freeze(this);
	}

	get size(): number {
		return this.valuesByKey.size;
	}

	get(key: K): V | undefined {
		return this.valuesByKey.get(key);
	}

	has(key: K): boolean {
		return this.valuesByKey.has(key);
	}

	forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
		for (const [key, value] of this.valuesByKey) {
			callbackfn.call(thisArg, value, key, this);
		}
	}

	entries(): MapIterator<[K, V]> {
		return this.valuesByKey.entries();
	}

	keys(): MapIterator<K> {
		return this.valuesByKey.keys();
	}

	values(): MapIterator<V> {
		return this.valuesByKey.values();
	}

	[Symbol.iterator](): MapIterator<[K, V]> {
		return this.entries();
	}
}
