import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { migrateCodingAgentHistoricalSession } from "@vetta/coding-agent/historical-sessions";
import { ConversationOwnershipConflictError } from "@vetta/runtime-storage/conversation";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots = new Set<string>();

afterEach(async () => {
	await Promise.all([...temporaryRoots].map((root) => rm(root, { force: true, recursive: true })));
	temporaryRoots.clear();
});

describe("historical session migration", () => {
	it("migrates without changing the source and reuses an identical target", async () => {
		const fixture = await createFixture(legacySession("hello"));
		const sourceContent = await readFile(fixture.sourcePath, "utf8");

		const migrated = await migrateCodingAgentHistoricalSession(fixture.sourcePath, fixture.targetRootDir);
		const reused = await migrateCodingAgentHistoricalSession(fixture.sourcePath, fixture.targetRootDir);

		expect(migrated).toMatchObject({ kind: "greenfield", status: "migrated" });
		expect(reused).toEqual({ ...migrated, status: "reused" });
		expect(await readFile(fixture.sourcePath, "utf8")).toBe(sourceContent);
	});

	it("creates a new deterministic target when the source content changes", async () => {
		const fixture = await createFixture(legacySession("before"));
		const before = await migrateCodingAgentHistoricalSession(fixture.sourcePath, fixture.targetRootDir);
		await writeFile(fixture.sourcePath, legacySession("after"), "utf8");

		const after = await migrateCodingAgentHistoricalSession(fixture.sourcePath, fixture.targetRootDir);

		expect(before).toMatchObject({ kind: "greenfield", status: "migrated" });
		expect(after).toMatchObject({ kind: "greenfield", status: "migrated" });
		if (before.kind !== "greenfield" || after.kind !== "greenfield") throw new Error("Expected migrations");
		expect(after.targetPath).not.toBe(before.targetPath);
	});

	it("uses and reuses a stable recovery target without overwriting a conflicting deterministic target", async () => {
		const fixture = await createFixture(legacySession("target conflict"));
		const migrated = await migrateCodingAgentHistoricalSession(fixture.sourcePath, fixture.targetRootDir);
		if (migrated.kind !== "greenfield") throw new Error("Expected initial migration");
		await writeFile(migrated.targetPath, "conflicting target", "utf8");

		const recovered = await migrateCodingAgentHistoricalSession(fixture.sourcePath, fixture.targetRootDir);
		const reused = await migrateCodingAgentHistoricalSession(fixture.sourcePath, fixture.targetRootDir);

		expect(recovered).toMatchObject({ kind: "greenfield", status: "migrated" });
		expect(reused).toEqual({ ...recovered, status: "reused" });
		if (recovered.kind !== "greenfield") throw new Error("Expected recovery migration");
		expect(recovered.targetSessionId).toBe(`${migrated.targetSessionId}-recovery`);
		expect(recovered.targetPath).not.toBe(migrated.targetPath);
		expect(await readFile(migrated.targetPath, "utf8")).toBe("conflicting target");
	});

	it("migrates an official BashExecution message through the Coding Agent normalizer", async () => {
		const bashMessage = {
			role: "bashExecution",
			command: "pwd",
			output: "C:/legacy-workspace",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			timestamp: 1,
		};
		const fixture = await createFixture(
			legacyJsonLines([
				legacyHeader(),
				{
					type: "message",
					id: "bash-1",
					parentId: null,
					timestamp: "2026-01-01T00:00:01.000Z",
					message: bashMessage,
				},
			]),
		);

		const result = await migrateCodingAgentHistoricalSession(fixture.sourcePath, fixture.targetRootDir);

		expect(result).toMatchObject({ kind: "greenfield", status: "migrated" });
		if (result.kind !== "greenfield") throw new Error("Expected Greenfield migration");
		const records = (await readFile(result.targetPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as unknown);
		expect(records[1]).toMatchObject({
			recordType: "conversation.import.seed",
			entries: [
				expect.objectContaining({
					type: "custom_message",
					modelVisible: true,
					details: { agentMessage: bashMessage },
				}),
			],
		});
	});

	it("reports a neutral ownership conflict while another Legacy owner holds the source lock", async () => {
		const fixture = await createFixture(legacySession("locked"));
		const canonicalSourcePath = await realpath(fixture.sourcePath);
		const lockPath = `${canonicalSourcePath}.lock`;
		await writeFile(
			lockPath,
			JSON.stringify({ pid: process.pid, hostname: hostname(), openedAt: new Date().toISOString() }),
			"utf8",
		);

		try {
			const migration = migrateCodingAgentHistoricalSession(fixture.sourcePath, fixture.targetRootDir);
			await expect(migration).rejects.toBeInstanceOf(ConversationOwnershipConflictError);
			await expect(migration).rejects.toMatchObject({
				name: "ConversationOwnershipConflictError",
				conversationPath: canonicalSourcePath,
				lockPath: `${canonicalSourcePath}.lock`,
				holder: {
					pid: process.pid,
					hostname: expect.any(String),
					acquiredAt: expect.any(String),
				},
			});
		} finally {
			await rm(lockPath, { force: true });
		}
	});

	it("does not turn an unexpected filesystem error into a Legacy fallback", async () => {
		const fixture = await createFixture(legacySession("filesystem failure"));
		await writeFile(fixture.targetRootDir, "not a directory", "utf8");

		await expect(
			migrateCodingAgentHistoricalSession(fixture.sourcePath, fixture.targetRootDir),
		).rejects.toMatchObject({
			code: expect.stringMatching(/^(?:EEXIST|ENOTDIR)$/),
		});
	});

	it("reports an explicit incompatibility when a known Legacy record cannot be represented by V2", async () => {
		const fixture = await createFixture(
			legacyJsonLines([
				legacyHeader(),
				{
					type: "message",
					id: "unsupported",
					parentId: null,
					timestamp: "2026-01-01T00:00:01.000Z",
					message: { role: "extension-private", payload: "unsupported", timestamp: 1 },
				},
			]),
		);

		await expect(
			migrateCodingAgentHistoricalSession(fixture.sourcePath, fixture.targetRootDir),
		).resolves.toMatchObject({
			kind: "session-incompatible",
			status: "not-representable",
			errorCode: "session_incompatible",
			issueCode: "invalid-payload",
			issueCount: 1,
		});
	});

	it("reports strict import issues without exposing source content", async () => {
		const fixture = await createFixture(
			`${JSON.stringify(legacyHeader())}\n${JSON.stringify({
				type: "future_entry",
				id: "future-1",
				parentId: null,
				timestamp: "2026-01-01T00:00:01.000Z",
				secret: "must-not-leak",
			})}\n{broken}\n`,
		);

		const result = await migrateCodingAgentHistoricalSession(fixture.sourcePath, fixture.targetRootDir);

		expect(result).toMatchObject({
			kind: "session-incompatible",
			status: "not-representable",
			errorCode: "session_version_unsupported",
			issueCode: "malformed-json",
			issueCount: 2,
		});
		expect(JSON.stringify(result)).not.toContain("must-not-leak");
	});
});

async function createFixture(content: string): Promise<{ sourcePath: string; targetRootDir: string }> {
	const root = await mkdtemp(join(tmpdir(), "vetta-greenfield-legacy-migration-"));
	temporaryRoots.add(root);
	const sourcePath = join(root, "legacy.jsonl");
	const targetRootDir = join(root, "conversations");
	await writeFile(sourcePath, content, "utf8");
	return { sourcePath, targetRootDir };
}

function legacySession(content: string): string {
	return legacyJsonLines([
		legacyHeader(),
		{
			type: "message",
			id: "user-1",
			parentId: null,
			timestamp: "2026-01-01T00:00:01.000Z",
			message: { role: "user", content, timestamp: 1 },
		},
	]);
}

function legacyHeader() {
	return {
		type: "session",
		version: 3,
		id: "legacy-source",
		timestamp: "2026-01-01T00:00:00.000Z",
		cwd: "C:/legacy-workspace",
	};
}

function legacyJsonLines(records: readonly unknown[]): string {
	return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}
