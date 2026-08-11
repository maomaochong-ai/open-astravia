import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
	applyMemoryDocumentOperation,
	DEFAULT_MEMORY_CHAR_LIMIT,
	type MemoryAction,
	type MemoryOperationInput,
	type MemoryState,
	parseMemoryEntries,
} from "./memory-document.js";

export interface MemoryStore {
	readContent(): string;
	readEntries(): readonly string[];
	apply(action: MemoryAction, input: MemoryOperationInput): MemoryState;
}

export interface FileMemoryStoreOptions {
	readonly path: string;
	readonly charLimit?: number;
}

export class FileMemoryStore implements MemoryStore {
	readonly path: string;
	readonly charLimit: number;

	constructor(options: FileMemoryStoreOptions) {
		this.path = options.path;
		this.charLimit = options.charLimit ?? DEFAULT_MEMORY_CHAR_LIMIT;
	}

	readContent(): string {
		try {
			return existsSync(this.path) ? readFileSync(this.path, "utf8") : "";
		} catch {
			return "";
		}
	}

	readEntries(): readonly string[] {
		return parseMemoryEntries(this.readContent());
	}

	apply(action: MemoryAction, input: MemoryOperationInput): MemoryState {
		const change = applyMemoryDocumentOperation(this.readContent(), action, input, this.charLimit);
		const temporaryPath = `${this.path}.tmp`;
		writeFileSync(temporaryPath, change.content);
		renameSync(temporaryPath, this.path);
		return change.state;
	}
}
