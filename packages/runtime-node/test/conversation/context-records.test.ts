import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	selectConversationDocumentMessages,
	selectConversationDocumentModelMessages,
} from "@vetta/runtime-core/conversation";
import { afterEach, describe, expect, it } from "vitest";
import { FileConversationRepository } from "../../src/conversation/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("conversation context records", () => {
	it("persists visible context on the branch without exposing hidden records as chat messages", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "vetta-context-records-"));
		temporaryRoots.push(rootDir);
		const repository = new FileConversationRepository({ rootDir });
		await repository.create({ sessionId: "session-1", createdAt: 1 });
		await repository.append("session-1", 0, [
			{
				type: "turn.started",
				sessionId: "session-1",
				turnId: "turn-1",
				snapshotId: "snapshot-1",
				timestamp: 2,
			},
			{
				type: "context.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				record: {
					type: "skill_expansion",
					content: "model-visible skill",
					modelVisible: true,
					display: false,
				},
				timestamp: 3,
			},
			{
				type: "context.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				record: {
					type: "prompt_resource_reference",
					content: "",
					modelVisible: false,
					display: false,
					metadata: { promptRef: { kind: "skill", name: "missing" } },
				},
				timestamp: 4,
			},
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				message: { role: "user", content: "actual prompt", timestamp: 5 },
				timestamp: 5,
			},
			{
				type: "turn.completed",
				sessionId: "session-1",
				turnId: "turn-1",
				stopReason: "stop",
				timestamp: 6,
			},
		]);
		await repository.close();

		const reopened = new FileConversationRepository({ rootDir });
		const conversation = await reopened.load("session-1");
		const document = await reopened.readDocument("session-1");

		expect(conversation.messages.map(({ content }) => content)).toEqual(["model-visible skill", "actual prompt"]);
		expect(selectConversationDocumentModelMessages(document).map(({ content }) => content)).toEqual([
			"model-visible skill",
			"actual prompt",
		]);
		expect(selectConversationDocumentMessages(document).map(({ content }) => content)).toEqual(["actual prompt"]);
		expect(document.entries).toMatchObject([
			{ id: "event-2", type: "custom_message", customType: "skill_expansion", modelVisible: true },
			{
				id: "event-3",
				type: "custom_message",
				customType: "prompt_resource_reference",
				modelVisible: false,
			},
			{ id: "event-4", type: "message", message: { role: "user" } },
		]);
		await reopened.close();
	});

	it("persists session-level context without manufacturing a turn", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "vetta-recorded-context-"));
		temporaryRoots.push(rootDir);
		const repository = new FileConversationRepository({ rootDir });
		await repository.create({ sessionId: "session-recorded", createdAt: 1 });
		await repository.append("session-recorded", 0, [
			{
				type: "context.recorded",
				sessionId: "session-recorded",
				record: {
					type: "extension-note",
					content: "remember this",
					modelVisible: true,
					timestamp: 2,
				},
				timestamp: 2,
			},
		]);
		await repository.close();

		const reopened = new FileConversationRepository({ rootDir });
		const conversation = await reopened.load("session-recorded");
		const document = await reopened.readDocument("session-recorded");
		expect(conversation.events).toMatchObject([{ type: "context.recorded" }]);
		expect(conversation.messages.map(({ content }) => content)).toEqual(["remember this"]);
		expect(document.entries).toMatchObject([
			{ type: "custom_message", customType: "extension-note", modelVisible: true },
		]);
		await reopened.close();
	});
});
