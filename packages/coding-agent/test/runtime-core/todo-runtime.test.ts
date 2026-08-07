import {
	applyConversationDocumentCommand,
	type ConversationDocument,
	createEmptyConversationDocument,
} from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { CodingAgentTodoRuntime } from "../../src/work-state/todo-runtime.js";
import { createCodingAgentTodoRuntimeToolRegistration } from "../../src/work-state/todo-tool-feature.js";

describe("CodingAgentTodoRuntime", () => {
	it("shares one store across Runtime Tool, persistence and Controller", async () => {
		let document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 1 });
		let entryIndex = 0;
		const runtime = new CodingAgentTodoRuntime({
			createEntryId: () => `todo-snapshot-${++entryIndex}`,
			now: () => 1,
		});
		runtime.initialize(document, {
			appendCustomEntry: async (entry) => {
				document = applyConversationDocumentCommand(document, {
					type: "custom.append",
					...entry,
				}).document;
				await runtime.onDocumentChanged(document);
			},
		});
		const registration = createCodingAgentTodoRuntimeToolRegistration(runtime);

		const result = await registration.tool.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "todo-call-1",
			input: {
				description: "Create an implementation plan",
				action: "create",
				items: ["Implement"],
			},
			signal: new AbortController().signal,
		});

		expect(result.content).toEqual([
			{
				type: "text",
				text: "Created 1 todo items:\n  #1 Implement\n\n[ ] #1 Implement\n\nProgress: 0/1 completed",
			},
		]);
		expect(runtime.getAll()).toEqual([{ id: 1, content: "Implement", status: "pending" }]);
		expect(runtime.readItems()).toEqual([{ id: 1, content: "Implement", status: "pending" }]);
		expect(document.entries.at(-1)).toMatchObject({
			type: "custom",
			customType: "todo_snapshot",
			data: {
				items: [{ id: 1, content: "Implement", status: "pending" }],
				lockedBy: null,
			},
		});
		expect(runtime.clear()).toBe(true);
		await runtime.flush();
		expect(runtime.readItems()).toEqual([]);
		await runtime.dispose();
	});

	it("restores the latest snapshot from the selected branch", () => {
		const runtime = new CodingAgentTodoRuntime();
		const root = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 1 });
		const firstBranch = appendSnapshot(root, "branch-a", "First", "pending");
		const secondBranch = appendSnapshot({ ...firstBranch, activeLeafId: null }, "branch-b", "Second", "done");
		runtime.initialize(secondBranch, {
			appendCustomEntry: async () => undefined,
		});

		expect(runtime.readItems()).toEqual([{ id: 1, content: "Second", status: "done" }]);

		runtime.onDocumentChanged({ ...secondBranch, activeLeafId: "branch-a" });
		expect(runtime.readItems()).toEqual([{ id: 1, content: "First", status: "pending" }]);
	});

	it("rejects malformed persisted snapshots at the storage boundary", () => {
		const runtime = new CodingAgentTodoRuntime();
		const malformed = applyConversationDocumentCommand(
			createEmptyConversationDocument({ sessionId: "session-1", createdAt: 1 }),
			{
				type: "custom.append",
				entryId: "invalid",
				customType: "todo_snapshot",
				data: { items: [{ id: "wrong" }], lockedBy: null },
				timestamp: "2026-07-28T00:00:00.000Z",
			},
		).document;

		expect(() =>
			runtime.initialize(malformed, {
				appendCustomEntry: vi.fn(async () => undefined),
			}),
		).toThrow("Invalid todo_snapshot entry: invalid");
	});
});

function appendSnapshot(
	document: ConversationDocument,
	entryId: string,
	content: string,
	status: "pending" | "done",
): ConversationDocument {
	return applyConversationDocumentCommand(document, {
		type: "custom.append",
		entryId,
		customType: "todo_snapshot",
		data: {
			items: [{ id: 1, content, status }],
			lockedBy: null,
		},
		timestamp: "2026-07-28T00:00:00.000Z",
	}).document;
}
