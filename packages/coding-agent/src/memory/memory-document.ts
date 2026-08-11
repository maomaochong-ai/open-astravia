export const DEFAULT_MEMORY_CHAR_LIMIT = 4_000;

const MEMORY_ENTRY_SEPARATOR = "\n\n§\n\n";

export type MemoryAction = "add" | "replace" | "remove";

export interface MemoryOperationInput {
	readonly content?: string;
	readonly match?: string;
}

export interface MemoryState {
	readonly entries: readonly string[];
	readonly chars: number;
	readonly limit: number;
}

export interface MemoryDocumentChange {
	readonly content: string;
	readonly state: MemoryState;
}

export function parseMemoryEntries(content: string): string[] {
	return content
		.split(MEMORY_ENTRY_SEPARATOR)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

export function serializeMemoryEntries(entries: readonly string[]): string {
	return entries.join(MEMORY_ENTRY_SEPARATOR);
}

export function applyMemoryDocumentOperation(
	currentContent: string,
	action: MemoryAction,
	input: MemoryOperationInput,
	limit: number = DEFAULT_MEMORY_CHAR_LIMIT,
): MemoryDocumentChange {
	const entries = parseMemoryEntries(currentContent);
	let next: string[];

	if (action === "add") {
		const content = (input.content ?? "").trim();
		if (!content) throw new Error("memory add: `content` is required and must be non-empty");
		next = [...entries, content];
		assertWithinLimit(action, next, limit);
	} else if (action === "replace") {
		const match = (input.match ?? "").trim();
		const content = (input.content ?? "").trim();
		if (!match) throw new Error("memory replace: `match` is required");
		if (!content) throw new Error("memory replace: `content` is required and must be non-empty");
		const index = entries.findIndex((entry) => entry.includes(match));
		if (index === -1) throw new Error(`memory replace: no entry matching ${JSON.stringify(match)}`);
		next = [...entries];
		next[index] = content;
		assertWithinLimit(action, next, limit);
	} else {
		const match = (input.match ?? "").trim();
		if (!match) throw new Error("memory remove: `match` is required");
		const index = entries.findIndex((entry) => entry.includes(match));
		if (index === -1) throw new Error(`memory remove: no entry matching ${JSON.stringify(match)}`);
		next = entries.filter((_, entryIndex) => entryIndex !== index);
	}

	const content = serializeMemoryEntries(next);
	return { content, state: { entries: next, chars: content.length, limit } };
}

function assertWithinLimit(action: "add" | "replace", entries: readonly string[], limit: number): void {
	const chars = serializeMemoryEntries(entries).length;
	if (chars <= limit) return;
	const recovery =
		action === "add"
			? "Remove or replace an existing entry first to make room."
			: "Shorten the entry or remove another one first.";
	throw new Error(`memory ${action}: would exceed the ${limit}-char limit (${chars}). ${recovery}`);
}
