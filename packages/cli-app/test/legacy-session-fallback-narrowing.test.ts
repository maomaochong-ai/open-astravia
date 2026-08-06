import { readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { migrateGreenfieldImLegacySession } from "../src/rpc/greenfield-im-legacy-session-migration.js";
import {
	type AgentRpcExecutable,
	type AgentRpcFixture,
	type AgentRpcProcess,
	buildAgentRpcExecutable,
	createAgentRpcFixture,
	readSessionFile,
	readSessionId,
	startAgentRpc,
} from "./support/agent-rpc-test-process.js";

const INTEGRATION_TEST_TIMEOUT_MS = 30_000;
const fixtures = new Set<AgentRpcFixture>();
const runningProcesses = new Set<AgentRpcProcess>();
let executable: AgentRpcExecutable;

beforeAll(async () => {
	executable = await buildAgentRpcExecutable();
}, INTEGRATION_TEST_TIMEOUT_MS);

afterAll(async () => {
	await executable.dispose();
}, INTEGRATION_TEST_TIMEOUT_MS);

afterEach(async () => {
	await Promise.all([...runningProcesses].map((process) => process.close()));
	runningProcesses.clear();
	await Promise.all([...fixtures].map((fixture) => fixture.dispose()));
	fixtures.clear();
}, INTEGRATION_TEST_TIMEOUT_MS);

describe("Historical session import recovery", { timeout: INTEGRATION_TEST_TIMEOUT_MS }, () => {
	it("reports a startup ownership conflict for a locked historical source", async () => {
		const fixture = await createFixture();
		const sourcePath = await writeLegacySession(fixture, "locked source");
		const lockPath = `${sourcePath}.lock`;
		await writeFile(
			lockPath,
			JSON.stringify({ pid: process.pid, hostname: hostname(), openedAt: new Date().toISOString() }),
			"utf8",
		);

		try {
			const childProcess = startRpc(fixture, ["--session", sourcePath]);
			const conflict = await childProcess.waitFor(
				(frame) => frame.type === "response" && frame.command === "startup",
			);

			expect(conflict).toMatchObject({
				type: "response",
				command: "startup",
				success: false,
				error: expect.stringContaining("already owned"),
				lockHolder: {
					pid: process.pid,
					hostname: expect.any(String),
					openedAt: expect.any(String),
				},
			});
			expect(await childProcess.waitForExit()).toBe(2);
		} finally {
			await rm(lockPath, { force: true });
		}
	});

	it("keeps a conflicting primary target and reuses one stable Greenfield recovery target", async () => {
		const fixture = await createFixture();
		const sourcePath = await writeLegacySession(fixture, "target conflict");
		const primary = await migrateGreenfieldImLegacySession(sourcePath, fixture.conversationDir);
		if (primary.kind !== "greenfield") throw new Error("Expected primary migration");
		await writeFile(primary.targetPath, "conflicting primary target", "utf8");

		const recovered = startRpc(fixture, ["--session", sourcePath]);
		const recoveredState = await recovered.request("recovered-state", "get_state");
		expect(recoveredState).toMatchObject({ success: true });
		const recoverySessionId = readSessionId(recoveredState);
		const recoverySessionFile = readSessionFile(recoveredState);
		expect(recoverySessionId).toBe(`${primary.targetSessionId}-recovery`);
		expect(recoverySessionFile).not.toBe(primary.targetPath);
		await recovered.close();

		const reused = startRpc(fixture, ["--session", sourcePath]);
		const reusedState = await reused.request("reused-state", "get_state");
		expect(reusedState).toMatchObject({
			success: true,
			data: {
				sessionId: recoverySessionId,
				sessionFile: recoverySessionFile,
			},
		});
		await reused.close();
		expect(await readFile(primary.targetPath, "utf8")).toBe("conflicting primary target");
	});
});

async function createFixture(): Promise<AgentRpcFixture> {
	const fixture = await createAgentRpcFixture();
	fixtures.add(fixture);
	return fixture;
}

function startRpc(fixture: AgentRpcFixture, extraArgs: readonly string[]): AgentRpcProcess {
	const process = startAgentRpc(executable, fixture, { extraArgs });
	runningProcesses.add(process);
	return process;
}

async function writeLegacySession(fixture: AgentRpcFixture, content: string): Promise<string> {
	const sourcePath = join(fixture.conversationDir, "legacy-source.jsonl");
	const records = [
		{
			type: "session",
			version: 3,
			id: "legacy-source",
			timestamp: "2026-01-01T00:00:00.000Z",
			cwd: fixture.workspace,
		},
		{
			type: "message",
			id: "legacy-user",
			parentId: null,
			timestamp: "2026-01-01T00:00:01.000Z",
			message: { role: "user", content, timestamp: 1 },
		},
	];
	await writeFile(sourcePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
	return sourcePath;
}
