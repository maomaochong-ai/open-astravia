import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageAppendedEvent, TurnCompletedEvent, TurnStartedEvent } from "@vetta/runtime-core/kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ConversationOwnershipConflictError,
	FileConversationOwnershipManager,
	FileConversationRepository,
	FileConversationRuntimeSessionCatalog,
	FileConversationRuntimeSessionFileHistoryReader,
} from "../../src/conversation/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Greenfield runtime session services", () => {
	it("lists, reads, renames and deletes conversation artifacts without exposing storage details", async () => {
		const rootDir = await createTemporaryRoot();
		const cwd = join(rootDir, "workspace");
		const repository = new FileConversationRepository({ rootDir });
		const sessionId = "greenfield/session";
		await repository.create({ sessionId, createdAt: 100 });
		await repository.append(sessionId, 0, [
			started(sessionId),
			userMessage(sessionId, "hello"),
			assistantMessage(sessionId, "world"),
			completed(sessionId),
		]);
		const stored = await repository.load(sessionId);
		await repository.saveSnapshot(sessionId, {
			sessionId,
			version: stored.version,
			messages: stored.messages,
			createdAt: 200,
		});
		const sessionPath = repository.resolveConversationPath(sessionId);
		const snapshotPath = sessionPath.replace(/\.conversation\.jsonl$/, ".snapshot.json");
		await repository.close();
		await writeFile(join(rootDir, "corrupt.conversation.jsonl"), "not-json\n", "utf8");

		const catalog = new FileConversationRuntimeSessionCatalog({
			roots: [{ cwd, sessionDir: rootDir }],
			artifactCleaner: {
				deleteSessionArtifacts: vi.fn(async (deletedSessionId) => {
					expect(deletedSessionId).toBe(sessionId);
				}),
			},
		});
		const reader = new FileConversationRuntimeSessionFileHistoryReader();

		expect(await catalog.listProjects()).toEqual([{ cwd, sessionCount: 1 }]);
		expect(await catalog.listSessions(cwd, rootDir)).toEqual([
			expect.objectContaining({
				id: sessionId,
				path: sessionPath,
				cwd,
				firstMessage: "hello",
				lastMessagePreview: "world",
			}),
		]);
		expect(await catalog.ownsSession(sessionPath)).toBe(true);
		expect(reader.canRead(sessionPath)).toBe(true);
		expect(reader.read(sessionPath).history).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "message",
					message: expect.objectContaining({ role: "user", content: "hello" }),
				}),
			]),
		);

		await catalog.renameSession(sessionPath, "renamed");
		expect((await catalog.listSessions(cwd, rootDir))[0]?.name).toBe("renamed");

		await catalog.deleteSessionArtifacts(sessionPath);
		expect(existsSync(sessionPath)).toBe(false);
		expect(existsSync(`${sessionPath}.lock`)).toBe(false);
		expect(existsSync(`${sessionPath}.owner.lock`)).toBe(false);
		expect(existsSync(snapshotPath)).toBe(false);
	});

	it("keeps the session file when auxiliary artifact cleanup fails so deletion can be retried", async () => {
		const rootDir = await createTemporaryRoot();
		const repository = new FileConversationRepository({ rootDir });
		const sessionId = "retryable-cleanup";
		await repository.create({ sessionId, createdAt: 100 });
		const sessionPath = repository.resolveConversationPath(sessionId);
		await repository.close();
		const catalog = new FileConversationRuntimeSessionCatalog({
			artifactCleaner: {
				deleteSessionArtifacts: async () => {
					throw new Error("artifact cleanup failed");
				},
			},
		});

		await expect(catalog.deleteSessionArtifacts(sessionPath)).rejects.toThrow("artifact cleanup failed");
		expect(existsSync(sessionPath)).toBe(true);
	});

	it("rejects lifecycle writes while another process-lifetime owner holds the conversation", async () => {
		const rootDir = await createTemporaryRoot();
		const repository = new FileConversationRepository({ rootDir });
		const sessionId = "owned-session";
		await repository.create({ sessionId, createdAt: 100 });
		const sessionPath = repository.resolveConversationPath(sessionId);
		await repository.close();

		const ownershipManager = new FileConversationOwnershipManager();
		const owner = await ownershipManager.acquire(sessionPath);
		const catalog = new FileConversationRuntimeSessionCatalog({ ownershipManager });
		try {
			await expect(catalog.renameSession(sessionPath, "blocked")).rejects.toBeInstanceOf(
				ConversationOwnershipConflictError,
			);
			await expect(catalog.deleteSessionArtifacts(sessionPath)).rejects.toBeInstanceOf(
				ConversationOwnershipConflictError,
			);
			expect(existsSync(sessionPath)).toBe(true);
		} finally {
			await owner.release();
		}

		await catalog.deleteSessionArtifacts(sessionPath);
		expect(existsSync(sessionPath)).toBe(false);
	});
});

async function createTemporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-runtime-session-services-"));
	temporaryRoots.push(root);
	return root;
}

function started(sessionId: string): TurnStartedEvent {
	return {
		type: "turn.started",
		sessionId,
		turnId: "turn-1",
		snapshotId: "snapshot-1",
		timestamp: 1,
	};
}

function userMessage(sessionId: string, text: string): MessageAppendedEvent {
	return {
		type: "message.appended",
		sessionId,
		turnId: "turn-1",
		message: { role: "user", content: text, timestamp: 2 },
		timestamp: 2,
	};
}

function assistantMessage(sessionId: string, text: string): MessageAppendedEvent {
	return {
		type: "message.appended",
		sessionId,
		turnId: "turn-1",
		message: {
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
			timestamp: 3,
		},
		timestamp: 3,
	};
}

function completed(sessionId: string): TurnCompletedEvent {
	return {
		type: "turn.completed",
		sessionId,
		turnId: "turn-1",
		stopReason: "stop",
		timestamp: 4,
	};
}
