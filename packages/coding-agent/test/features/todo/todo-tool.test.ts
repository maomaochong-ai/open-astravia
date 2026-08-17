import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import { TodoState } from "../../../src/features/todo/todo-state.js";
import {
	createTodoToolRegistration,
	TODO_TOOL_CATEGORY,
	TODO_TOOL_DESCRIPTION,
	TODO_TOOL_SCOPES,
	type TodoToolInput,
	TodoToolInputSchema,
} from "../../../src/features/todo/tool/index.js";

describe("Coding Agent Todo Tool", () => {
	it("owns the stable Tool definition and registration metadata", () => {
		const registration = createTodoToolRegistration({ getTodoStore: () => new TodoState() });

		expect({
			name: registration.tool.name,
			label: registration.tool.label,
			description: registration.tool.description,
			schema: registration.tool.inputSchema,
			scopeUse: registration.scopeUse,
			category: registration.category,
		}).toEqual({
			name: "todo",
			label: "todo",
			description: TODO_TOOL_DESCRIPTION,
			schema: TodoToolInputSchema,
			scopeUse: TODO_TOOL_SCOPES,
			category: TODO_TOOL_CATEGORY,
		});
	});

	it("preserves creation, update, listing, and clear behavior", async () => {
		const state = new TodoState();
		const tool = createTodoToolRegistration({ getTodoStore: () => state }).tool;
		const results = [];
		for (const input of [
			{ action: "create" as const, items: ["First", "Second"] },
			{ action: "update" as const, id: 1, status: "in_progress" as const },
			{ action: "list" as const },
			{ action: "clear" as const },
		]) {
			results.push(await executeTodo(tool, input));
		}

		expect(results.map((result) => result.details)).toEqual([
			{ action: "create" },
			{ action: "update" },
			{ action: "list" },
			{ action: "clear" },
		]);
		expect(results[0]?.content[0]).toMatchObject({ text: expect.stringContaining("Created 2 todo items") });
		expect(results[1]?.content[0]).toMatchObject({ text: expect.stringContaining("Updated #1 → in_progress") });
		expect(results[2]?.content[0]).toMatchObject({ text: expect.stringContaining("[~] #1 First") });
		expect(results[3]?.content[0]).toMatchObject({ text: expect.stringContaining("Cleared all todo items") });
		expect(state.getAll()).toEqual([]);
	});

	it("keeps scene-owned plans locked and sequential", async () => {
		const state = new TodoState();
		state.createMany(["First", "Second"]);
		state.lock("scene");
		const tool = createTodoToolRegistration({ getTodoStore: () => state }).tool;

		const skipped = await executeTodo(tool, { action: "update", id: 2, status: "done" });
		const cleared = await executeTodo(tool, { action: "clear" });

		expect(skipped.content[0]).toMatchObject({ text: expect.stringContaining("earlier items are not done") });
		expect(cleared.content[0]).toMatchObject({ text: expect.stringContaining("locked by scene") });
		expect(state.getAll()).toEqual([
			{ id: 1, content: "First", status: "pending" },
			{ id: 2, content: "Second", status: "pending" },
		]);
	});
});

function executeTodo(tool: RuntimeToolDefinition<TodoToolInput>, input: TodoToolInput) {
	return tool.execute({
		sessionId: "session",
		turnId: "turn",
		toolCallId: "todo",
		input,
		signal: new AbortController().signal,
	});
}
