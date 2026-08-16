import type { MemoryTextStorage } from "../../src/memory/index.js";

export function createMemoryTextStorage(initial?: string): MemoryTextStorage {
	let content = initial;
	return {
		read: () => content,
		replace: (next) => {
			content = next;
		},
		append: (next) => {
			content = `${content ?? ""}${next}`;
		},
	};
}

export function readMemoryTextStorage(storage: MemoryTextStorage): string {
	return storage.read() ?? "";
}
