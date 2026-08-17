import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import {
	createMemoryToolRegistration,
	MEMORY_TOOL_CATEGORY,
	MEMORY_TOOL_DESCRIPTION,
	MEMORY_TOOL_SCOPES,
	MemoryToolInputSchema,
	type MemoryToolOperations,
} from "../../src/memory/index.js";

describe("Memory tool contract", () => {
	it("keeps the model-visible definition and registration metadata", () => {
		const registration = createMemoryToolRegistration({ operations: createOperations() });
		expect({
			name: registration.tool.name,
			label: registration.tool.label,
			description: registration.tool.description,
			schema: registration.tool.inputSchema,
			scopeUse: registration.scopeUse,
			category: registration.category,
		}).toEqual({
			name: "memory",
			label: "Memory",
			description: MEMORY_TOOL_DESCRIPTION,
			schema: MemoryToolInputSchema,
			scopeUse: MEMORY_TOOL_SCOPES,
			category: MEMORY_TOOL_CATEGORY,
		});
	});

	it("keeps add, replace and result projection behavior", async () => {
		const runtime = createMemoryToolRegistration({ operations: createOperations() }).tool;
		expect(await execute(runtime, { action: "add", content: "Uses Bun" })).toEqual({
			content: [{ type: "text", text: "memory add ok — 1 entry, 8/4000 chars.\n\nCurrent memory:\n1. Uses Bun" }],
			details: { action: "add", entryCount: 1, chars: 8, limit: 4_000 },
		});
		expect(await execute(runtime, { action: "replace", match: "Bun", content: "Uses Bun workspaces" })).toEqual({
			content: [
				{
					type: "text",
					text: "memory replace ok — 1 entry, 19/4000 chars.\n\nCurrent memory:\n1. Uses Bun workspaces",
				},
			],
			details: { action: "replace", entryCount: 1, chars: 19, limit: 4_000 },
		});
	});
});

async function execute<TInput extends object>(tool: RuntimeToolDefinition<TInput>, input: TInput) {
	return tool.execute({
		sessionId: "session",
		turnId: "turn",
		toolCallId: "memory",
		input,
		signal: new AbortController().signal,
	});
}

function createOperations(): MemoryToolOperations {
	const entries: string[] = [];
	return {
		apply(action, input) {
			if (action === "add") entries.push(input.content ?? "");
			if (action === "replace") {
				const index = entries.findIndex((entry) => entry.includes(input.match ?? ""));
				if (index >= 0) entries[index] = input.content ?? "";
			}
			if (action === "remove") {
				const index = entries.findIndex((entry) => entry.includes(input.match ?? ""));
				if (index >= 0) entries.splice(index, 1);
			}
			return { entries: [...entries], chars: entries.join("\n\n§\n\n").length, limit: 4_000 };
		},
	};
}
