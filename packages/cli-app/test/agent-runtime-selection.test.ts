import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

const fixtures = new Set<AgentRpcFixture>();
const runningProcesses = new Set<AgentRpcProcess>();
let executable: AgentRpcExecutable;

beforeAll(async () => {
	executable = await buildAgentRpcExecutable();
});

afterAll(async () => {
	await executable.dispose();
});

afterEach(async () => {
	await Promise.all([...runningProcesses].map((process) => process.close()));
	runningProcesses.clear();
	await Promise.all([...fixtures].map((fixture) => fixture.dispose()));
	fixtures.clear();
});

describe("Agent Runtime production host", () => {
	it("runs the full RPC profile through the single production host", async () => {
		const fixture = await createFixture();
		const process = startAgentRpc(executable, fixture, { backend: null });
		runningProcesses.add(process);

		await expect(process.request("default-state", "get_state")).resolves.toMatchObject({
			command: "get_state",
			success: true,
			data: { sessionId: expect.any(String) },
		});
		await expect(process.request("models", "get_available_models")).resolves.toMatchObject({
			command: "get_available_models",
			success: true,
			data: { models: [expect.objectContaining({ provider: "test", id: "test-model" })] },
		});
		await expect(process.request("thinking", "cycle_thinking_level")).resolves.toMatchObject({
			command: "cycle_thinking_level",
			success: true,
			data: { level: expect.any(String) },
		});
		await expect(process.request("queue", "set_steering_mode", { mode: "one-at-a-time" })).resolves.toMatchObject({
			command: "set_steering_mode",
			success: true,
		});
		await expect(process.request("retry", "set_auto_retry", { enabled: false })).resolves.toMatchObject({
			command: "set_auto_retry",
			success: true,
		});
		await expect(process.request("auto-compact", "set_auto_compaction", { enabled: false })).resolves.toMatchObject({
			command: "set_auto_compaction",
			success: true,
		});
		await expect(process.request("name", "set_session_name", { name: "neutral-rpc" })).resolves.toMatchObject({
			command: "set_session_name",
			success: true,
		});
		const bash = await process.request("bash", "bash", {
			command: `node -e "process.stdout.write('greenfield-rpc')"`,
		});
		expect(bash).toMatchObject({
			command: "bash",
			success: true,
			data: { output: "greenfield-rpc", exitCode: 0, cancelled: false },
		});
		await expect(process.request("messages", "get_messages")).resolves.toMatchObject({
			command: "get_messages",
			success: true,
			data: {
				messages: [expect.objectContaining({ role: "bashExecution", command: expect.stringContaining("node -e") })],
			},
		});
		await expect(process.request("stats", "get_session_stats")).resolves.toMatchObject({
			command: "get_session_stats",
			success: true,
			data: { sessionId: expect.any(String), totalMessages: expect.any(Number) },
		});
		await expect(process.request("renamed-state", "get_state")).resolves.toMatchObject({
			data: { sessionName: "neutral-rpc", autoCompactionEnabled: false },
		});
		const exportPath = join(fixture.root, "greenfield-session.html");
		await expect(process.request("export", "export_html", { outputPath: exportPath })).resolves.toMatchObject({
			command: "export_html",
			success: true,
			data: { path: exportPath },
		});
		await expect(stat(exportPath)).resolves.toMatchObject({ size: expect.any(Number) });
		await process.close();
	}, 30_000);

	it("runs fresh and resumed Greenfield conversations through pure JSONL stdout and releases ownership", async () => {
		const fixture = await createFixture();
		const fresh = await startRpc(fixture);
		const freshState = await fresh.request("fresh-state", "get_state");
		expect(freshState).toMatchObject({
			id: "fresh-state",
			type: "response",
			command: "get_state",
			success: true,
			data: { sessionId: expect.any(String) },
		});
		const sessionFile = readSessionFile(freshState);
		const sessionId = readSessionId(freshState);
		expect(sessionFile.endsWith(".conversation.jsonl")).toBe(true);
		await expect(stat(`${sessionFile}.owner.lock`)).resolves.toBeDefined();
		await expect(fresh.request("abort-idle", "abort")).resolves.toMatchObject({
			id: "abort-idle",
			type: "response",
			command: "abort",
			success: true,
		});
		await expect(fresh.request("flush-disabled-memory", "flush_memory")).resolves.toMatchObject({
			id: "flush-disabled-memory",
			type: "response",
			command: "flush_memory",
			success: true,
			data: { written: 0 },
		});

		await fresh.close();
		await expect(stat(`${sessionFile}.owner.lock`)).rejects.toMatchObject({ code: "ENOENT" });

		const resumed = await startRpc(fixture, ["--session", sessionFile]);
		const resumedState = await resumed.request("resumed-state", "get_state");
		expect(resumedState).toMatchObject({
			id: "resumed-state",
			type: "response",
			command: "get_state",
			success: true,
			data: { sessionId, sessionFile },
		});
		await resumed.close();

		const continued = await startRpc(fixture, ["--continue"]);
		const continuedState = await continued.request("continued-state", "get_state");
		expect(continuedState).toMatchObject({
			id: "continued-state",
			type: "response",
			command: "get_state",
			success: true,
			data: { sessionId, sessionFile },
		});
		await continued.close();
	}, 30_000);

	it("creates a Greenfield conversation when continue has no previous session", async () => {
		const fixture = await createFixture();
		const continued = await startRpc(fixture, ["--continue"]);
		const state = await continued.request("empty-continue-state", "get_state");
		expect(state).toMatchObject({
			id: "empty-continue-state",
			type: "response",
			command: "get_state",
			success: true,
			data: { sessionId: expect.any(String) },
		});
		expect(readSessionFile(state).endsWith(".conversation.jsonl")).toBe(true);
		await continued.close();
	});

	it("keeps a combined event, tool and command Extension on the Greenfield runtime", async () => {
		const fixture = await createFixture();
		const extensionPath = await writeFixtureExtension(
			fixture,
			"combined-extension.ts",
			`export default function(pi) {
				pi.on("session_start", async () => {});
				pi.registerCommand("extension-audit", { handler: async () => {} });
				pi.registerTool({
					name: "extension_echo",
					label: "Extension Echo",
					description: "Echo a value.",
					parameters: {
						type: "object",
						properties: { value: { type: "string" } },
						required: ["value"],
					},
					async execute(_id, params) {
						return { content: [{ type: "text", text: params.value }], details: {} };
					},
				});
			}`,
		);

		const process = await startRpc(fixture, ["--extension", extensionPath]);
		await expect(process.request("combined-state", "get_state")).resolves.toMatchObject({
			type: "response",
			command: "get_state",
			success: true,
		});
		await process.close();
	});

	it("treats UI-only Extension registrations as inapplicable in the RPC host", async () => {
		const fixture = await createFixture();
		const extensionPath = await writeFixtureExtension(
			fixture,
			"ui-only-extension.ts",
			`export default function(pi) {
				pi.registerShortcut("ctrl+shift+r", { handler: async () => {} });
				pi.registerMessageRenderer("audit-card", () => null);
				pi.on("user_bash", async () => ({ result: undefined }));
			}`,
		);

		const process = await startRpc(fixture, ["--extension", extensionPath]);
		await expect(process.request("ui-only-state", "get_state")).resolves.toMatchObject({
			type: "response",
			command: "get_state",
			success: true,
		});
		await process.close();
	});

	it("reports a structured startup failure for a forward Extension incompatibility", async () => {
		const fixture = await createFixture();
		const extensionPath = await writeFixtureExtension(
			fixture,
			"forward-event-extension.ts",
			`export default function(pi) {
				pi.on("future_event", async () => {});
			}`,
		);

		const process = await startRpc(fixture, ["--extension", extensionPath]);
		const failure = await process.waitFor((frame) => frame.type === "response" && frame.command === "startup");
		expect(failure).toMatchObject({
			type: "response",
			command: "startup",
			success: false,
			errorCode: "extension_incompatible",
			unsupportedEvents: ["future_event"],
			unmetRuntimeCapabilities: ["event-handler"],
		});
		expect(await process.waitForExit()).toBe(2);
		expect(process.frames).toEqual([failure]);
	});

	it("preserves the startup lock-conflict wire contract", async () => {
		const fixture = await createFixture();
		const owner = await startRpc(fixture);
		const ownerState = await owner.request("owner-state", "get_state");
		const sessionFile = readSessionFile(ownerState);

		const conflicting = await startRpc(fixture, ["--session", sessionFile]);
		const conflict = await conflicting.waitFor((frame) => frame.type === "response" && frame.command === "startup");
		expect(conflict).toMatchObject({
			type: "response",
			command: "startup",
			success: false,
			error: expect.stringContaining("already owned"),
			lockHolder: {
				pid: expect.any(Number),
				hostname: expect.any(String),
				openedAt: expect.any(String),
			},
		});
		expect(await conflicting.waitForExit()).toBe(2);

		await owner.close();
	});

	it("migrates and reuses a representable Legacy session without changing its source", async () => {
		const fixture = await createFixture();
		const legacySession = join(fixture.conversationDir, "legacy.jsonl");
		const legacyContent = `${JSON.stringify({
			type: "session",
			version: 3,
			id: "legacy-session",
			timestamp: new Date().toISOString(),
			cwd: fixture.workspace,
		})}\n${JSON.stringify({
			type: "message",
			id: "legacy-user",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: { role: "user", content: "legacy", timestamp: Date.now() },
		})}\n`;
		await writeFile(legacySession, legacyContent, "utf8");

		const migrated = await startRpc(fixture, ["--session", legacySession]);
		const state = await migrated.request("legacy-state", "get_state");
		expect(state).toMatchObject({
			id: "legacy-state",
			type: "response",
			command: "get_state",
			success: true,
			data: {
				sessionId: expect.stringMatching(/^legacy-import-/),
				sessionFile: expect.stringMatching(/\.conversation\.jsonl$/),
			},
		});
		const migratedSessionId = readSessionId(state);
		const migratedSessionFile = readSessionFile(state);
		await migrated.close();
		expect(await readFile(legacySession, "utf8")).toBe(legacyContent);

		const reused = await startRpc(fixture, ["--session", legacySession]);
		const reusedState = await reused.request("legacy-reused-state", "get_state");
		expect(reusedState).toMatchObject({
			id: "legacy-reused-state",
			type: "response",
			command: "get_state",
			success: true,
			data: {
				sessionId: migratedSessionId,
				sessionFile: migratedSessionFile,
			},
		});
		await reused.close();
	});

	it("fails explicitly when an existing session is not representable by Greenfield", async () => {
		const fixture = await createFixture();
		const legacySession = join(fixture.conversationDir, "legacy-assistant.jsonl");
		await writeFile(
			legacySession,
			`${JSON.stringify({
				type: "session",
				version: 3,
				id: "legacy-assistant-session",
				timestamp: new Date().toISOString(),
				cwd: fixture.workspace,
			})}\n${JSON.stringify({
				type: "message",
				id: "legacy-assistant",
				parentId: null,
				timestamp: new Date().toISOString(),
				message: { role: "assistant", content: "legacy", timestamp: Date.now() },
			})}\n`,
			"utf8",
		);

		const process = await startRpc(fixture, ["--session", legacySession]);
		const failure = await process.waitFor((frame) => frame.type === "response" && frame.command === "startup");
		expect(failure).toMatchObject({
			type: "response",
			command: "startup",
			success: false,
			errorCode: "session_incompatible",
			sessionPath: await realpath(legacySession),
			issueCode: "invalid-payload",
			issueCount: 1,
		});
		expect(await process.waitForExit()).toBe(2);
		expect(process.frames).toEqual([failure]);
	});
});

async function createFixture(): Promise<AgentRpcFixture> {
	const fixture = await createAgentRpcFixture();
	fixtures.add(fixture);
	return fixture;
}

async function startRpc(fixture: AgentRpcFixture, extraArgs: readonly string[] = []): Promise<AgentRpcProcess> {
	const process = startAgentRpc(executable, fixture, { extraArgs });
	runningProcesses.add(process);
	return process;
}

async function writeFixtureExtension(fixture: AgentRpcFixture, name: string, source: string): Promise<string> {
	const extensionPath = join(fixture.root, name);
	await writeFile(extensionPath, source, "utf8");
	return extensionPath;
}
