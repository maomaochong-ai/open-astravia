import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONVERSATION_STORAGE_ERROR_CODES, FileConversationOwnershipManager } from "../../src/conversation/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("FileConversationOwnershipManager", () => {
	it("holds exclusive ownership until the lease is released", async () => {
		const conversationPath = await temporaryConversationPath();
		const first = new FileConversationOwnershipManager();
		const second = new FileConversationOwnershipManager();
		const lease = await first.acquire(conversationPath);

		await expect(second.acquire(conversationPath)).rejects.toMatchObject({
			code: CONVERSATION_STORAGE_ERROR_CODES.OWNERSHIP_CONFLICT,
			conversationPath,
			lockPath: `${conversationPath}.owner.lock`,
			holder: {
				pid: process.pid,
			},
		});

		await lease.release();
		const replacement = await second.acquire(conversationPath);
		await replacement.release();
		await expect(stat(`${conversationPath}.owner.lock`)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("does not let an old lease remove a replacement owner", async () => {
		const conversationPath = await temporaryConversationPath();
		const first = new FileConversationOwnershipManager({ createToken: () => "first" });
		const lease = await first.acquire(conversationPath);
		const lockPath = `${conversationPath}.owner.lock`;
		const replacement = {
			token: "replacement",
			pid: process.pid,
			hostname: lease.holder.hostname,
			acquiredAt: new Date().toISOString(),
		};
		await writeFile(lockPath, JSON.stringify(replacement), "utf8");

		await lease.release();

		expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(replacement);
	});

	it("retries release after a transient filesystem failure", async () => {
		const conversationPath = await temporaryConversationPath();
		const manager = new FileConversationOwnershipManager({ createToken: () => "owner" });
		const lease = await manager.acquire(conversationPath);
		const lockPath = lease.lockPath;
		await rm(lockPath);
		await mkdir(lockPath);

		await expect(lease.release()).rejects.toBeDefined();
		await rm(lockPath, { recursive: true });
		await writeFile(lockPath, JSON.stringify(lease.holder), "utf8");
		await expect(lease.release()).resolves.toBeUndefined();
		await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("reclaims a dead owner on the same host without waiting for the stale timeout", async () => {
		const conversationPath = await temporaryConversationPath();
		const lockPath = `${conversationPath}.owner.lock`;
		const manager = new FileConversationOwnershipManager({
			heartbeatIntervalMs: 10_000,
			staleAfterMs: 20_000,
			hostname: "test-host",
			isProcessAlive: () => false,
		});
		await writeFile(
			lockPath,
			JSON.stringify({
				token: "dead",
				pid: 999_999,
				hostname: "test-host",
				acquiredAt: new Date().toISOString(),
			}),
			"utf8",
		);

		const lease = await manager.acquire(conversationPath);

		expect(lease.holder.token).not.toBe("dead");
		await lease.release();
	});

	it("reclaims a reused pid when the process start time no longer matches", async () => {
		const conversationPath = await temporaryConversationPath();
		const lockPath = `${conversationPath}.owner.lock`;
		const manager = new FileConversationOwnershipManager({
			heartbeatIntervalMs: 10_000,
			staleAfterMs: 20_000,
			hostname: "test-host",
			isProcessAlive: () => true,
			readProcessStartedAtMs: () => Date.parse("2026-01-01T00:00:00.000Z"),
		});
		await writeFile(
			lockPath,
			JSON.stringify({
				token: "reused",
				pid: 1234,
				hostname: "test-host",
				acquiredAt: "2025-01-01T00:00:00.000Z",
				processStartedAt: "2025-01-01T00:00:00.000Z",
			}),
			"utf8",
		);

		const lease = await manager.acquire(conversationPath);
		expect(lease.holder.token).not.toBe("reused");
		await lease.release();
	});
});

async function temporaryConversationPath(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-conversation-owner-"));
	temporaryRoots.push(root);
	return join(root, "session.conversation.jsonl");
}
