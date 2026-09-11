import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConversationTagsFile } from "../../shared/conversation-tags.js";
import {
	addConversationTag,
	assignConversationTag,
	forgetConversations,
	listConversationTags,
	onConversationTagsChanged,
	removeConversationTag,
	renameConversationTag,
	resetConversationTagsCache,
} from "./conversation-tags-store.js";

const roots: string[] = [];

function tempFile(): string {
	const root = mkdtempSync(join(tmpdir(), "vetta-tags-"));
	roots.push(root);
	resetConversationTagsCache();
	return join(root, "conversation-tags.json");
}

function onDisk(filePath: string): ReturnType<typeof parseConversationTagsFile> {
	return parseConversationTagsFile(JSON.parse(readFileSync(filePath, "utf-8")) as unknown);
}

afterEach(() => {
	resetConversationTagsCache();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("conversation tags store", () => {
	it("persists a created tag together with its first assignment", () => {
		const filePath = tempFile();
		const snapshot = addConversationTag({ name: "重要", color: "#FF5F57", sessionPath: "/a.jsonl" }, filePath);
		expect(snapshot.tags).toHaveLength(1);
		expect(onDisk(filePath)).toEqual(snapshot);
	});

	it("keeps sequential mutations from clobbering each other on disk", () => {
		const filePath = tempFile();
		const created = addConversationTag({ name: "重要", color: "#ff5f57" }, filePath);
		const tagId = created.tags[0].id;
		assignConversationTag({ sessionPath: "/a.jsonl", tagId, assigned: true }, filePath);
		assignConversationTag({ sessionPath: "/b.jsonl", tagId, assigned: true }, filePath);
		renameConversationTag({ id: tagId, name: "紧急" }, filePath);

		const stored = onDisk(filePath);
		expect(stored.tags[0].name).toBe("紧急");
		expect(Object.keys(stored.assignments).sort()).toEqual(["/a.jsonl", "/b.jsonl"]);
	});

	it("reloads the persisted snapshot after the cache is dropped", () => {
		const filePath = tempFile();
		addConversationTag({ name: "重要", color: "#ff5f57", sessionPath: "/a.jsonl" }, filePath);
		resetConversationTagsCache();
		expect(listConversationTags(filePath).tags[0]?.name).toBe("重要");
	});

	it("falls back to an empty snapshot when the file is corrupt", () => {
		const filePath = tempFile();
		writeFileSync(filePath, "{ not json");
		expect(listConversationTags(filePath)).toEqual({ tags: [], assignments: {} });
	});

	it("cascades tag deletion and conversation removal into assignments", () => {
		const filePath = tempFile();
		const tagId = addConversationTag({ name: "重要", color: "#ff5f57", sessionPath: "/a.jsonl" }, filePath).tags[0]
			.id;
		assignConversationTag({ sessionPath: "/b.jsonl", tagId, assigned: true }, filePath);

		expect(forgetConversations(["/a.jsonl"], filePath).assignments).toEqual({ "/b.jsonl": [tagId] });
		expect(removeConversationTag(tagId, filePath)).toEqual({ tags: [], assignments: {} });
		expect(onDisk(filePath)).toEqual({ tags: [], assignments: {} });
	});

	it("notifies subscribers only when a mutation actually changed something", () => {
		const filePath = tempFile();
		const seen: number[] = [];
		const unsubscribe = onConversationTagsChanged((snapshot) => seen.push(snapshot.tags.length));

		addConversationTag({ name: "重要", color: "#ff5f57" }, filePath);
		removeConversationTag("ghost", filePath);
		renameConversationTag({ id: "ghost", name: "无" }, filePath);
		unsubscribe();
		addConversationTag({ name: "待办", color: "#0a84ff" }, filePath);

		expect(seen).toEqual([1]);
	});

	it("keeps new tags last even when the clock does not advance", () => {
		const filePath = tempFile();
		addConversationTag({ name: "一", color: "#ff5f57", createdAt: Date.now() + 60_000 }, filePath);
		const snapshot = addConversationTag({ name: "二", color: "#0a84ff" }, filePath);
		expect(snapshot.tags.map((tag) => tag.name)).toEqual(["一", "二"]);
	});
});
