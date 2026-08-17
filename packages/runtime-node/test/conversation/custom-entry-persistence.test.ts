import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileConversationRepository } from "../../src/conversation/file-conversation-repository.js";

describe("conversation custom entry persistence", () => {
	const directories: string[] = [];

	afterEach(async () => {
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("replays a persisted custom entry with its branch parent", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "conversation-custom-entry-"));
		directories.push(rootDir);
		const repository = new FileConversationRepository({ rootDir });
		await repository.create({ sessionId: "session-1", createdAt: 1 });
		await repository.append("session-1", 0, [
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				message: { role: "user", content: "start", timestamp: 1 },
				timestamp: 1,
			},
		]);
		await repository.execute("session-1", 1, {
			type: "custom.append",
			entryId: "todo-1",
			customType: "todo_snapshot",
			data: {
				items: [{ id: 1, content: "Persist", status: "done" }],
				lockedBy: null,
			},
			timestamp: "2026-07-28T00:00:00.000Z",
		});
		await repository.close();

		const reopened = new FileConversationRepository({ rootDir });
		const document = await reopened.readDocument("session-1");

		expect(document.activeLeafId).toBe("todo-1");
		expect(document.entries.at(-1)).toEqual({
			type: "custom",
			id: "todo-1",
			parentId: "event-1",
			timestamp: "2026-07-28T00:00:00.000Z",
			customType: "todo_snapshot",
			data: {
				items: [{ id: 1, content: "Persist", status: "done" }],
				lockedBy: null,
			},
		});

		const fork = await reopened.fork("session-1", "event-1");
		const forkedDocument = await reopened.readDocument(fork.sessionId);
		expect(forkedDocument.entries).toEqual([
			{
				type: "message",
				id: "event-1",
				parentId: null,
				timestamp: new Date(1).toISOString(),
				message: { role: "user", content: "start", timestamp: 1 },
			},
			{
				type: "custom",
				id: "todo-1",
				parentId: "event-1",
				timestamp: "2026-07-28T00:00:00.000Z",
				customType: "todo_snapshot",
				data: {
					items: [{ id: 1, content: "Persist", status: "done" }],
					lockedBy: null,
				},
			},
		]);
		await reopened.close();
	});

	it("applies append-only Extension metadata to the latest document revision", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "conversation-extension-metadata-"));
		directories.push(rootDir);
		const repository = new FileConversationRepository({ rootDir });
		await repository.create({ sessionId: "session-metadata", createdAt: 1 });
		await repository.execute("session-metadata", null, {
			type: "custom.append",
			entryId: "entry-1",
			customType: "audit",
			data: { ok: true },
			timestamp: "2026-07-31T00:00:00.000Z",
		});
		await repository.execute("session-metadata", null, {
			type: "entry.label.set",
			entryId: "label-1",
			targetId: "entry-1",
			label: "Checked",
			timestamp: "2026-07-31T00:00:01.000Z",
		});

		const document = await repository.readDocument("session-metadata");
		expect(document.entries).toMatchObject([
			{ id: "entry-1", type: "custom", customType: "audit" },
			{ id: "label-1", type: "label", targetId: "entry-1", label: "Checked" },
		]);
		await repository.close();
	});

	it("persists and replays a branch summary document command", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "conversation-branch-summary-"));
		directories.push(rootDir);
		const repository = new FileConversationRepository({ rootDir });
		await repository.create({ sessionId: "session-summary", createdAt: 1 });
		await repository.execute("session-summary", 0, {
			type: "branch_summary.append",
			entryId: "summary-1",
			parentId: null,
			summary: "Extension branch summary",
			details: { source: "extension" },
			fromHook: true,
			timestamp: "2026-08-01T00:00:00.000Z",
		});
		const conversation = await repository.load("session-summary");
		await repository.append("session-summary", conversation.version, [
			{
				type: "message.appended",
				sessionId: "session-summary",
				turnId: "turn-after-summary",
				message: { role: "user", content: "after summary", timestamp: 3 },
				timestamp: 3,
			},
		]);
		await repository.close();

		const reopened = new FileConversationRepository({ rootDir });
		const document = await reopened.readDocument("session-summary");
		expect(document.activeLeafId).not.toBe("summary-1");
		expect(document.entries).toEqual([
			{
				type: "branch_summary",
				id: "summary-1",
				parentId: null,
				timestamp: "2026-08-01T00:00:00.000Z",
				fromId: "root",
				summary: "Extension branch summary",
				details: { source: "extension" },
				fromHook: true,
			},
			expect.objectContaining({ type: "message", parentId: "summary-1" }),
		]);
		await reopened.close();
	});
});
