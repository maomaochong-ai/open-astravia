import type { AssistantMessage, Message, UserMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import {
	applyConversationDocumentCommand,
	type ConversationDocument,
	resolveConversationUserTurnTip,
	selectConversationDocumentMessages,
} from "../../src/conversation/index.js";

describe("ConversationDocument commands", () => {
	it("switches to the newest tip below the selected branch", () => {
		const result = applyConversationDocumentCommand(document(), {
			type: "branch.select",
			entryId: "user-old",
		});

		expect(result).toMatchObject({ changed: true, leafId: "assistant-old" });
		expect(result.document.revision).toBe(7);
		expect(selectConversationDocumentMessages(result.document).map(messageText)).toEqual([
			"root",
			"root answer",
			"old branch",
			"old answer",
		]);
	});

	it("deletes one message and reparents its surviving descendants", () => {
		const result = applyConversationDocumentCommand(document(), {
			type: "message.delete",
			entryId: "assistant-root",
		});

		expect(result.document.entries.map(({ id }) => id)).not.toContain("assistant-root");
		expect(result.document.entries.find(({ id }) => id === "user-old")?.parentId).toBe("user-root");
		expect(result.document.entries.find(({ id }) => id === "user-new")?.parentId).toBe("user-root");
		expect(result.document.activeLeafId).toBe("assistant-new");
	});

	it("repairs compaction and branch-summary references when deleting a message", () => {
		const source: ConversationDocument = {
			...document(),
			revision: 8,
			activeLeafId: "compaction",
			entries: [
				...document().entries,
				{
					type: "branch_summary",
					id: "branch-summary",
					parentId: "assistant-new",
					timestamp: new Date(7).toISOString(),
					fromId: "assistant-root",
					summary: "summary",
				},
				{
					type: "compaction",
					id: "compaction",
					parentId: "branch-summary",
					timestamp: new Date(8).toISOString(),
					summary: "compacted",
					firstKeptEntryId: "assistant-root",
					tokensBefore: 100,
				},
			],
		};

		const result = applyConversationDocumentCommand(source, {
			type: "message.delete",
			entryId: "assistant-root",
		});

		expect(result.document.entries.find(({ id }) => id === "branch-summary")).toMatchObject({
			parentId: "assistant-new",
			fromId: "user-root",
		});
		expect(result.document.entries.find(({ id }) => id === "compaction")).toMatchObject({
			firstKeptEntryId: "user-new",
		});
	});

	it("removes the active last user turn and its reply subtree", () => {
		const result = applyConversationDocumentCommand(document(), {
			type: "user_turn.replace",
			entryId: "user-new",
		});

		expect(result.document.entries.map(({ id }) => id)).toEqual([
			"user-root",
			"assistant-root",
			"user-old",
			"assistant-old",
		]);
		expect(result.document.activeLeafId).toBe("assistant-root");
		expect(selectConversationDocumentMessages(result.document).map(messageText)).toEqual(["root", "root answer"]);
	});

	it("does not advance the revision for an idempotent command", () => {
		const source = document();
		const result = applyConversationDocumentCommand(source, {
			type: "active_leaf.set",
			entryId: "assistant-new",
		});

		expect(result).toEqual({ document: source, changed: false, leafId: "assistant-new" });
	});

	it("normalizes session names while preserving the legacy append semantics", () => {
		const result = applyConversationDocumentCommand(document(), {
			type: "session.name.set",
			name: "  renamed  ",
		});

		expect(result.document).toMatchObject({ name: "renamed", revision: 7 });
		expect(result.changed).toBe(true);
	});

	it("appends a branch summary at the navigation target and makes it active", () => {
		const result = applyConversationDocumentCommand(document(), {
			type: "branch_summary.append",
			entryId: "branch-summary",
			parentId: "assistant-root",
			summary: "abandoned work",
			details: { readFiles: ["README.md"] },
			fromHook: true,
			timestamp: new Date(7).toISOString(),
		});

		expect(result.document.entries.at(-1)).toEqual({
			type: "branch_summary",
			id: "branch-summary",
			parentId: "assistant-root",
			timestamp: new Date(7).toISOString(),
			fromId: "assistant-root",
			summary: "abandoned work",
			details: { readFiles: ["README.md"] },
			fromHook: true,
		});
		expect(result.document.activeLeafId).toBe("branch-summary");
	});

	it("rejects a branch summary whose navigation target is missing", () => {
		expect(() =>
			applyConversationDocumentCommand(document(), {
				type: "branch_summary.append",
				entryId: "branch-summary",
				parentId: "missing",
				summary: "summary",
				timestamp: new Date(7).toISOString(),
			}),
		).toThrow("Entry missing not found");
	});

	it("rejects an unexpected persisted command revision", () => {
		expect(() =>
			applyConversationDocumentCommand(document(), { type: "session.name.set", name: "renamed" }, 8),
		).toThrow("revision 8 does not follow 6");
	});

	it("resolves the reply tip belonging to one user turn", () => {
		expect(resolveConversationUserTurnTip(document(), "user-old")).toBe("assistant-old");
	});
});

function document(): ConversationDocument {
	return {
		identity: { sessionId: "session-1", createdAt: 1 },
		journalVersion: 0,
		revision: 6,
		activeLeafId: "assistant-new",
		entries: [
			entry("user-root", null, 1, userMessage("root")),
			entry("assistant-root", "user-root", 2, assistantMessage("root answer")),
			entry("user-old", "assistant-root", 3, userMessage("old branch")),
			entry("assistant-old", "user-old", 4, assistantMessage("old answer")),
			entry("user-new", "assistant-root", 5, userMessage("new branch")),
			entry("assistant-new", "user-new", 6, assistantMessage("new answer")),
		],
	};
}

function entry(id: string, parentId: string | null, timestamp: number, message: UserMessage | AssistantMessage) {
	return {
		type: "message" as const,
		id,
		parentId,
		timestamp: new Date(timestamp).toISOString(),
		message,
	};
}

function userMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: 1 };
}

function assistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "test-model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
	};
}

function messageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((content) => content.type === "text")
		.map((content) => content.text)
		.join("");
}
