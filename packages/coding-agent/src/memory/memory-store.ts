import {
	applyMemoryDocumentOperation,
	DEFAULT_MEMORY_CHAR_LIMIT,
	type MemoryAction,
	type MemoryOperationInput,
	type MemoryState,
	parseMemoryEntries,
} from "./memory-document.js";
import type { MemoryScope } from "./memory-scope.js";
import type { MemoryTextStorage } from "./memory-storage.js";
import type { MemoryToolOperations, MemoryToolState } from "./memory-tool.js";

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

export interface MemoryScopeBinding {
	readonly scope: MemoryScope;
	readonly file: string;
	readonly store: MemoryStore;
}

export interface ScopedMemoryStoreOptions {
	readonly defaultScope: MemoryScope;
	/** 按优先级排列；提示词与错误信息都沿用这个顺序。 */
	readonly bindings: readonly MemoryScopeBinding[];
}

/**
 * `memory` 工具的操作端口：按作用域选择落盘文件。未配置的作用域会被明确拒绝，
 * 而不是静默回落到另一个文件。
 */
export class ScopedMemoryStore implements MemoryToolOperations {
	private readonly bindings: readonly MemoryScopeBinding[];
	private readonly defaultScope: MemoryScope;

	constructor(options: ScopedMemoryStoreOptions) {
		this.bindings = options.bindings;
		this.defaultScope = options.defaultScope;
	}

	apply(
		action: Parameters<MemoryToolOperations["apply"]>[0],
		input: Parameters<MemoryToolOperations["apply"]>[1],
	): MemoryToolState {
		const scope = input.scope ?? this.defaultScope;
		const binding = this.bindings.find((candidate) => candidate.scope === scope);
		if (!binding) {
			throw new Error(
				`memory ${action}: the ${JSON.stringify(scope)} scope is not available in this session ` +
					`(available: ${this.bindings.map((candidate) => JSON.stringify(candidate.scope)).join(", ")}).`,
			);
		}
		return {
			...binding.store.apply(action, { content: input.content, match: input.match }),
			scope: binding.scope,
			file: binding.file,
		};
	}
}
