import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationDocumentEntry } from "@vetta/runtime-core/conversation";
import { afterEach, describe, expect, it } from "vitest";
import {
	CONVERSATION_STORAGE_ERROR_CODES,
	createConversationSeedDraft,
	FileConversationRepository,
	publishConversationSeed,
	resolveConversationFilePath,
} from "../../src/conversation/index.js";

describe("conversation seed publisher", () => {
	const temporaryDirectories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("atomically publishes a native V2 document with identity and name", async () => {
		const rootDir = await temporaryDirectory(temporaryDirectories);
		const entries: ConversationDocumentEntry[] = [
			{
				type: "custom",
				id: "seed-entry",
				parentId: null,
				timestamp: "2026-08-05T00:00:00.000Z",
				customType: "fixture",
				data: { ready: true },
			},
		];

		const result = await publishConversationSeed({
			targetRootDir: rootDir,
			targetSessionId: "native-seed",
			createdAt: 10,
			cwd: "C:\\workspace",
			parentSessionPath: "C:\\sessions\\parent.conversation.jsonl",
			entries,
			activeLeafId: "seed-entry",
			name: "seeded",
		});

		expect(result.targetPath).toBe(resolveConversationFilePath(rootDir, "native-seed"));
		expect(result.document).toMatchObject({
			identity: {
				sessionId: "native-seed",
				cwd: "C:\\workspace",
				parentSessionPath: "C:\\sessions\\parent.conversation.jsonl",
			},
			activeLeafId: "seed-entry",
			name: "seeded",
		});
		const content = await readFile(result.targetPath, "utf8");
		expect(content).toContain('"recordType":"conversation.seed"');
		expect(content).not.toContain("conversation.import.seed");
	});

	it("rejects an existing target instead of overwriting it", async () => {
		const rootDir = await temporaryDirectory(temporaryDirectories);
		const options = {
			targetRootDir: rootDir,
			targetSessionId: "duplicate",
			createdAt: 10,
			entries: [] as readonly ConversationDocumentEntry[],
			activeLeafId: null,
		};
		await publishConversationSeed(options);

		await expect(publishConversationSeed(options)).rejects.toMatchObject({
			code: CONVERSATION_STORAGE_ERROR_CODES.ALREADY_EXISTS,
		});
	});

	it("keeps a native seed draft readable across synchronous updates", async () => {
		const rootDir = await temporaryDirectory(temporaryDirectories);
		const draft = await createConversationSeedDraft({
			targetRootDir: rootDir,
			targetSessionId: "draft",
			createdAt: 10,
		});
		expect(await readFile(draft.targetPath, "utf8")).toContain('"entries":[]');

		draft.update({
			entries: [
				{
					type: "custom",
					id: "draft-entry",
					parentId: null,
					timestamp: "2026-08-05T00:00:00.000Z",
					customType: "fixture",
				},
			],
			activeLeafId: "draft-entry",
		});

		const content = await readFile(draft.targetPath, "utf8");
		expect(content).toContain("draft-entry");
		expect(content).toContain('"recordType":"conversation.seed"');
	});

	it("preserves native seed entries when the conversation is forked", async () => {
		const rootDir = await temporaryDirectory(temporaryDirectories);
		await publishConversationSeed({
			targetRootDir: rootDir,
			targetSessionId: "fork-source",
			createdAt: 10,
			entries: [
				{
					type: "message",
					id: "prompt",
					parentId: null,
					timestamp: "2026-08-05T00:00:00.000Z",
					message: { role: "user", content: "fork me", timestamp: 10 },
				},
			],
			activeLeafId: "prompt",
		});
		const repository = new FileConversationRepository({ rootDir });

		const fork = await repository.fork("fork-source", "prompt");
		const forkedDocument = await repository.readDocument(fork.sessionId);

		expect(fork.text).toBe("fork me");
		expect(forkedDocument.entries).toContainEqual(expect.objectContaining({ id: "prompt", type: "message" }));
		expect(forkedDocument.activeLeafId).toBe("prompt");
	});
});

async function temporaryDirectory(collection: string[]): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "conversation-seed-publisher-"));
	collection.push(directory);
	return directory;
}
