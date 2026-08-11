import { describe, expect, it } from "vitest";
import {
	assertConversationDocumentGraph,
	type ConversationDocumentEntry,
	createSeededConversationDocument,
} from "../../src/conversation/index.js";

describe("Conversation Document graph validation", () => {
	it("accepts cross-branch summaries and compaction boundaries before or after the compaction entry", () => {
		const entries: ConversationDocumentEntry[] = [
			custom("root", null),
			custom("summarized-sibling", "root"),
			{
				type: "branch_summary",
				id: "summary",
				parentId: "root",
				timestamp: timestamp(3),
				fromId: "summarized-sibling",
				summary: "summary",
			},
			{
				type: "compaction",
				id: "legacy-compaction",
				parentId: "summary",
				timestamp: timestamp(4),
				firstKeptEntryId: "root",
				summary: "legacy compacted",
				tokensBefore: 100,
			},
			{
				type: "compaction",
				id: "continuation-compaction",
				parentId: "legacy-compaction",
				timestamp: timestamp(5),
				firstKeptEntryId: "continued-tail",
				summary: "continued compacted",
				tokensBefore: 50,
			},
			custom("continued-tail", "continuation-compaction"),
			{
				type: "label",
				id: "label",
				parentId: "continued-tail",
				timestamp: timestamp(7),
				targetId: "summarized-sibling",
				label: "kept",
			},
		];

		expect(() => assertConversationDocumentGraph(entries, "label")).not.toThrow();
		expect(createSeededConversationDocument({ sessionId: "valid", createdAt: 1 }, entries, "label")).toMatchObject({
			revision: 7,
			activeLeafId: "label",
		});
	});

	it.each([
		{
			name: "duplicate IDs",
			entries: [custom("duplicate", null), custom("duplicate", null)],
			activeLeafId: "duplicate",
			message: "entry already exists",
		},
		{
			name: "a missing parent",
			entries: [custom("orphan", "missing")],
			activeLeafId: "orphan",
			message: "parent does not exist",
		},
		{
			name: "a parent cycle",
			entries: [custom("cycle-a", "cycle-b"), custom("cycle-b", "cycle-a")],
			activeLeafId: "cycle-a",
			message: "contains a cycle",
		},
		{
			name: "a missing active leaf",
			entries: [custom("root", null)],
			activeLeafId: "missing",
			message: "active leaf does not exist",
		},
		{
			name: "a dangling branch summary source",
			entries: [
				custom("root", null),
				{
					type: "branch_summary" as const,
					id: "summary",
					parentId: "root",
					timestamp: timestamp(2),
					fromId: "missing",
					summary: "summary",
				},
			],
			activeLeafId: "summary",
			message: "branch summary source does not exist",
		},
		{
			name: "a dangling label target",
			entries: [
				custom("root", null),
				{
					type: "label" as const,
					id: "label",
					parentId: "root",
					timestamp: timestamp(2),
					targetId: "missing",
				},
			],
			activeLeafId: "label",
			message: "label target does not exist",
		},
		{
			name: "a dangling compaction boundary",
			entries: [
				custom("root", null),
				{
					type: "compaction" as const,
					id: "compaction",
					parentId: "root",
					timestamp: timestamp(2),
					firstKeptEntryId: "missing",
					summary: "summary",
					tokensBefore: 10,
				},
			],
			activeLeafId: "compaction",
			message: "first kept entry does not exist",
		},
		{
			name: "a compaction boundary on a sibling branch",
			entries: [
				custom("root", null),
				custom("left", "root"),
				custom("right", "root"),
				{
					type: "compaction" as const,
					id: "compaction",
					parentId: "left",
					timestamp: timestamp(4),
					firstKeptEntryId: "right",
					summary: "summary",
					tokensBefore: 10,
				},
			],
			activeLeafId: "compaction",
			message: "first kept entry is not on the same branch",
		},
	] satisfies readonly {
		readonly name: string;
		readonly entries: readonly ConversationDocumentEntry[];
		readonly activeLeafId: string | null;
		readonly message: string;
	}[])("rejects $name", ({ entries, activeLeafId, message }) => {
		expect(() => assertConversationDocumentGraph(entries, activeLeafId)).toThrow(message);
		expect(() =>
			createSeededConversationDocument({ sessionId: "invalid", createdAt: 1 }, entries, activeLeafId),
		).toThrow(message);
	});
});

function custom(id: string, parentId: string | null): ConversationDocumentEntry {
	return {
		type: "custom",
		id,
		parentId,
		timestamp: timestamp(1),
		customType: "fixture",
	};
}

function timestamp(second: number): string {
	return `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;
}
