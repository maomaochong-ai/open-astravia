import { describe, expect, it } from "vitest";
import {
	conversationCountForTag,
	conversationTagIds,
	createConversationTag,
	deleteConversationTag,
	emptyConversationTags,
	normalizeTagColor,
	parseConversationTagsFile,
	removeConversationAssignments,
	setConversationTagAssigned,
	updateConversationTag,
} from "./conversation-tags";

const RED = "#ff5f57";
const BLUE = "#0a84ff";

function withTags(): ReturnType<typeof createConversationTag> {
	const base = createConversationTag(emptyConversationTags(), {
		id: "t1",
		name: "重要",
		color: RED,
		createdAt: 10,
	});
	return createConversationTag(base, { id: "t2", name: "待办", color: BLUE, createdAt: 20 });
}

describe("conversation tag colors", () => {
	it("normalizes shorthand and cased hex, rejecting anything else", () => {
		expect(normalizeTagColor("#F00")).toBe("#ff0000");
		expect(normalizeTagColor("  #FF5F57 ")).toBe(RED);
		expect(normalizeTagColor("red")).toBeNull();
		expect(normalizeTagColor("#ff5f5")).toBeNull();
		expect(normalizeTagColor(0xff5f57)).toBeNull();
	});
});

describe("conversation tag mutations", () => {
	it("creates a tag and stamps it onto the originating conversation", () => {
		const snapshot = createConversationTag(emptyConversationTags(), {
			id: "t1",
			name: "重要",
			color: RED,
			createdAt: 10,
			sessionPath: "/a.jsonl",
		});
		expect(snapshot.tags).toEqual([{ id: "t1", name: "重要", color: RED, createdAt: 10 }]);
		expect(conversationTagIds(snapshot, "/a.jsonl")).toEqual(["t1"]);
	});

	it("rejects tags without a usable name or color", () => {
		const blank = createConversationTag(emptyConversationTags(), {
			id: "t1",
			name: "   ",
			color: RED,
			createdAt: 10,
		});
		expect(blank.tags).toEqual([]);
		const badColor = createConversationTag(emptyConversationTags(), {
			id: "t1",
			name: "重要",
			color: "nope",
			createdAt: 10,
		});
		expect(badColor.tags).toEqual([]);
	});

	it("orders tags by creation time so menu positions stay stable", () => {
		const snapshot = createConversationTag(withTags(), { id: "t0", name: "最早", color: RED, createdAt: 1 });
		expect(snapshot.tags.map((tag) => tag.id)).toEqual(["t0", "t1", "t2"]);
	});

	it("toggles an assignment without disturbing the other tags on that conversation", () => {
		let snapshot = withTags();
		snapshot = setConversationTagAssigned(snapshot, { sessionPath: "/a.jsonl", tagId: "t1", assigned: true });
		snapshot = setConversationTagAssigned(snapshot, { sessionPath: "/a.jsonl", tagId: "t2", assigned: true });
		snapshot = setConversationTagAssigned(snapshot, { sessionPath: "/a.jsonl", tagId: "t1", assigned: false });
		expect(conversationTagIds(snapshot, "/a.jsonl")).toEqual(["t2"]);

		snapshot = setConversationTagAssigned(snapshot, { sessionPath: "/a.jsonl", tagId: "t2", assigned: false });
		expect(snapshot.assignments).toEqual({});
	});

	it("ignores assignments that reference an unknown tag", () => {
		const snapshot = withTags();
		expect(setConversationTagAssigned(snapshot, { sessionPath: "/a.jsonl", tagId: "ghost", assigned: true })).toBe(
			snapshot,
		);
	});

	it("renames and recolors a tag in place", () => {
		const snapshot = updateConversationTag(withTags(), { id: "t1", name: "紧急", color: "#ABCDEF" });
		expect(snapshot.tags[0]).toEqual({ id: "t1", name: "紧急", color: "#abcdef", createdAt: 10 });
	});

	it("keeps the tag untouched when the rename payload is unusable", () => {
		const snapshot = withTags();
		expect(updateConversationTag(snapshot, { id: "t1", name: "  " })).toBe(snapshot);
		expect(updateConversationTag(snapshot, { id: "t1", color: "chartreuse" })).toBe(snapshot);
	});

	it("cascades a tag deletion into every conversation carrying it", () => {
		let snapshot = withTags();
		snapshot = setConversationTagAssigned(snapshot, { sessionPath: "/a.jsonl", tagId: "t1", assigned: true });
		snapshot = setConversationTagAssigned(snapshot, { sessionPath: "/a.jsonl", tagId: "t2", assigned: true });
		snapshot = setConversationTagAssigned(snapshot, { sessionPath: "/b.jsonl", tagId: "t1", assigned: true });
		expect(conversationCountForTag(snapshot, "t1")).toBe(2);

		snapshot = deleteConversationTag(snapshot, "t1");
		expect(snapshot.tags.map((tag) => tag.id)).toEqual(["t2"]);
		expect(snapshot.assignments).toEqual({ "/a.jsonl": ["t2"] });
	});

	it("forgets assignments belonging to deleted conversations", () => {
		let snapshot = setConversationTagAssigned(withTags(), {
			sessionPath: "/a.jsonl",
			tagId: "t1",
			assigned: true,
		});
		snapshot = setConversationTagAssigned(snapshot, { sessionPath: "/b.jsonl", tagId: "t2", assigned: true });
		snapshot = removeConversationAssignments(snapshot, ["/a.jsonl", "/missing.jsonl"]);
		expect(snapshot.assignments).toEqual({ "/b.jsonl": ["t2"] });
	});
});

describe("conversation tag file parsing", () => {
	it("drops damaged entries instead of discarding the whole file", () => {
		const snapshot = parseConversationTagsFile({
			version: 1,
			tags: [
				{ id: "t1", name: "重要", color: "#FF5F57", createdAt: 10 },
				{ id: "t1", name: "重复 id", color: BLUE, createdAt: 11 },
				{ id: "t2", name: "无色", color: "nope", createdAt: 12 },
				{ name: "无 id", color: BLUE, createdAt: 13 },
				"garbage",
			],
			assignments: {
				"/a.jsonl": ["t1", "t1", "ghost"],
				"/b.jsonl": ["ghost"],
				"/c.jsonl": "not-an-array",
			},
		});
		expect(snapshot.tags).toEqual([{ id: "t1", name: "重要", color: RED, createdAt: 10 }]);
		expect(snapshot.assignments).toEqual({ "/a.jsonl": ["t1"] });
	});

	it("treats an unknown schema version or non-object payload as empty", () => {
		expect(parseConversationTagsFile({ version: 99, tags: [{ id: "t1", name: "x", color: RED }] }).tags).toEqual([]);
		expect(parseConversationTagsFile(null)).toEqual(emptyConversationTags());
		expect(parseConversationTagsFile([])).toEqual(emptyConversationTags());
	});
});
