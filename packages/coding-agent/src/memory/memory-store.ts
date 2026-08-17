import {
	applyMemoryDocumentOperation,
	DEFAULT_MEMORY_CHAR_LIMIT,
	type MemoryAction,
	type MemoryOperationInput,
	type MemoryState,
	parseMemoryEntries,
} from "./memory-document.js";
import type { MemoryTextStorage } from "./memory-storage.js";

export interface MemoryStore {
	readContent(): string;
	readEntries(): readonly string[];
	apply(action: MemoryAction, input: MemoryOperationInput): MemoryState;
}

export interface MemoryStoreOptions {
	readonly storage: MemoryTextStorage;
	readonly charLimit?: number;
}

export class MemoryDocumentStore implements MemoryStore {
	private readonly storage: MemoryTextStorage;
	readonly charLimit: number;

	constructor(options: MemoryStoreOptions) {
		this.storage = options.storage;
		this.charLimit = options.charLimit ?? DEFAULT_MEMORY_CHAR_LIMIT;
	}

	readContent(): string {
		try {
			return this.storage.read() ?? "";
		} catch {
			return "";
		}
	}

	readEntries(): readonly string[] {
		return parseMemoryEntries(this.readContent());
	}

	apply(action: MemoryAction, input: MemoryOperationInput): MemoryState {
		const change = applyMemoryDocumentOperation(this.readContent(), action, input, this.charLimit);
		this.storage.replace(change.content);
		return change.state;
	}
}
