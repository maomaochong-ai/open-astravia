import type { Message } from "@vetta/ai";
import type { ContextCompositionSectionInput, ContextSectionSource } from "./contracts.js";

export function instructionSection(input: {
	readonly id: string;
	readonly category?: string;
	readonly source: ContextSectionSource;
	readonly content: string;
}): ContextCompositionSectionInput {
	return { ...input, kind: "instruction" };
}

export function toolSchemaSection(input: {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: Readonly<Record<string, unknown>>;
	readonly category?: string;
	readonly source: ContextSectionSource;
}): ContextCompositionSectionInput {
	return {
		id: `tool:${input.name}`,
		kind: "tool_schema",
		category: input.category,
		source: input.source,
		content: stableJsonStringify({
			name: input.name,
			description: input.description,
			inputSchema: input.inputSchema,
		}),
	};
}

export function messageSection(input: {
	readonly id: string;
	readonly kind: "history" | "runtime_context" | "user_input";
	readonly source: ContextSectionSource;
	readonly message: Message;
}): ContextCompositionSectionInput {
	return {
		id: input.id,
		kind: input.kind,
		source: input.source,
		content: stableJsonStringify(input.message),
	};
}

export function stableJsonStringify(value: unknown): string {
	return JSON.stringify(sortJsonValue(value)) ?? "null";
}

function sortJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJsonValue);
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(
		Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, sortJsonValue(entry)]),
	);
}
