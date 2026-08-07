import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type AgentRpcExecutable,
	type AgentRpcFixture,
	type AgentRpcProcess,
	buildAgentRpcExecutable,
	createAgentRpcFixture,
	readSessionFile,
	startAgentRpc,
} from "./support/agent-rpc-test-process.js";

let executable: AgentRpcExecutable;

beforeAll(async () => {
	executable = await buildAgentRpcExecutable();
}, 60_000);

afterAll(async () => {
	await executable.dispose();
});

describe("RPC CLI initialization failure cleanup contract", () => {
	it("releases Extension, Hook, MCP and conversation ownership before restarting the same Session", async () => {
		let fixture: AgentRpcFixture | undefined;
		let failedProcess: AgentRpcProcess | undefined;
		let restartedProcess: AgentRpcProcess | undefined;
		try {
			fixture = await createAgentRpcFixture();
			const auditPath = join(fixture.root, "initialization-lifecycle.jsonl");
			const mcpPidPath = join(fixture.root, "initialization-mcp.pid");
			const extensionPath = await writeFailingExtension(fixture, auditPath);
			await Promise.all([writeProjectHookConfigs(fixture, auditPath), writeHealthyMcpServer(fixture, mcpPidPath)]);

			failedProcess = startAgentRpc(executable, fixture, { extraArgs: ["--extension", extensionPath] });
			const failedMcpPid = await waitForPid(mcpPidPath);
			await expect(failedProcess.waitForExit()).resolves.toBe(1);
			await failedProcess.close();
			expect(failedProcess.stderr).toContain("resolveResourcePath");
			await expect(waitForProcessExit(failedMcpPid)).resolves.toBe(true);

			const sessionFile = await readOnlyConversationPath(fixture);
			expect(await readOwnershipLocks(fixture)).toEqual([]);
			expect(await readLifecycleEvents(auditPath)).toEqual([
				"extension:session_start",
				"extension:session_shutdown",
				"hook:SessionEnd",
			]);

			restartedProcess = startAgentRpc(executable, fixture, { extraArgs: ["--session", sessionFile] });
			const state = await restartedProcess.request("restart-state", "get_state");
			expect(readSessionFile(state)).toBe(sessionFile);
			expect(existsSync(`${sessionFile}.owner.lock`)).toBe(true);
			const restartedMcpPid = await waitForDifferentPid(mcpPidPath, failedMcpPid);
			expect(isProcessAlive(restartedMcpPid)).toBe(true);

			await expect(restartedProcess.close()).resolves.toBe(0);
			restartedProcess = undefined;
			await expect(waitForProcessExit(restartedMcpPid)).resolves.toBe(true);
			expect(await readOwnershipLocks(fixture)).toEqual([]);
		} finally {
			await failedProcess?.close();
			await restartedProcess?.close();
			await fixture?.dispose();
		}
	}, 60_000);

	it("closes a failed MCP stdio process without preventing the CLI Session from starting", async () => {
		let fixture: AgentRpcFixture | undefined;
		let activeProcess: AgentRpcProcess | undefined;
		try {
			fixture = await createAgentRpcFixture();
			const mcpPidPath = join(fixture.root, "failed-mcp.pid");
			await writeFailingMcpServer(fixture, mcpPidPath);

			activeProcess = startAgentRpc(executable, fixture);
			const state = await activeProcess.request("failed-mcp-state", "get_state");
			const sessionFile = readSessionFile(state);
			const failedMcpPid = await waitForPid(mcpPidPath);

			await expect(waitForProcessExit(failedMcpPid)).resolves.toBe(true);
			expect(existsSync(`${sessionFile}.owner.lock`)).toBe(true);
			await expect(activeProcess.close()).resolves.toBe(0);
			activeProcess = undefined;
			expect(await readOwnershipLocks(fixture)).toEqual([]);
		} finally {
			await activeProcess?.close();
			await fixture?.dispose();
		}
	}, 60_000);
});

async function writeFailingExtension(fixture: AgentRpcFixture, auditPath: string): Promise<string> {
	const extensionPath = join(fixture.root, "initialization-failure-extension.ts");
	await writeFile(
		extensionPath,
		`import { appendFileSync } from "node:fs";
		const auditPath = ${JSON.stringify(auditPath)};
		function record(event) {
			appendFileSync(auditPath, JSON.stringify({ owner: "extension", event: event.type }) + "\\n", "utf8");
		}
		export default function(pi) {
			pi.on("session_start", async (event) => record(event));
			pi.on("session_shutdown", async (event) => record(event));
			pi.on("resources_discover", async () => ({ skillPaths: [null] }));
		}`,
		"utf8",
	);
	return extensionPath;
}

async function writeProjectHookConfigs(fixture: AgentRpcFixture, auditPath: string): Promise<void> {
	const hookScriptPath = join(fixture.workspace, ".vetta", "initialization-hook.cjs");
	const codexDirectory = join(fixture.workspace, ".vetta", ".codex");
	const claudeDirectory = join(fixture.workspace, ".vetta", ".claude");
	await Promise.all([mkdir(codexDirectory, { recursive: true }), mkdir(claudeDirectory, { recursive: true })]);
	await writeFile(
		hookScriptPath,
		`const { appendFileSync, readFileSync } = require("node:fs");
		const input = JSON.parse(readFileSync(0, "utf8"));
		appendFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ owner: "hook", event: input.hook_event_name }) + "\\n", "utf8");`,
		"utf8",
	);
	const command = "bun .vetta/initialization-hook.cjs";
	await Promise.all([
		writeFile(
			join(codexDirectory, "hooks.json"),
			JSON.stringify({
				hooks: { SessionStart: [{ hooks: [{ type: "command", command, commandWindows: command }] }] },
			}),
			"utf8",
		),
		writeFile(
			join(claudeDirectory, "settings.json"),
			JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: "command", command }] }] } }),
			"utf8",
		),
	]);
}

async function writeHealthyMcpServer(fixture: AgentRpcFixture, pidPath: string): Promise<void> {
	const serverPath = join(fixture.root, "initialization-mcp-server.mjs");
	await writeFile(
		serverPath,
		`import { writeFileSync } from "node:fs";
		import { createInterface } from "node:readline";
		writeFileSync(${JSON.stringify(pidPath)}, String(process.pid), "utf8");
		const lines = createInterface({ input: process.stdin });
		for await (const line of lines) {
			const request = JSON.parse(line);
			if (!Object.hasOwn(request, "id")) continue;
			const result = request.method === "initialize"
				? { protocolVersion: request.params?.protocolVersion ?? "2024-11-05", capabilities: {}, serverInfo: { name: "initialization-audit", version: "1" } }
				: {};
			process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
		}`,
		"utf8",
	);
	await writeMcpConfig(fixture, serverPath);
}

async function writeFailingMcpServer(fixture: AgentRpcFixture, pidPath: string): Promise<void> {
	const serverPath = join(fixture.root, "failing-mcp-server.mjs");
	await writeFile(
		serverPath,
		`import { writeFileSync } from "node:fs";
		writeFileSync(${JSON.stringify(pidPath)}, String(process.pid), "utf8");
		process.stdin.resume();
		process.stdin.once("end", () => process.exit(0));
		process.stdout.write("invalid-json\\n");
		setInterval(() => {}, 1000);`,
		"utf8",
	);
	await writeMcpConfig(fixture, serverPath);
}

async function writeMcpConfig(fixture: AgentRpcFixture, serverPath: string): Promise<void> {
	await writeFile(
		join(fixture.agentDir, "mcp.json"),
		JSON.stringify({
			mcpServers: {
				initialization_audit: { command: process.execPath, args: [serverPath], startupTimeout: 10_000 },
			},
		}),
		"utf8",
	);
}

async function readOnlyConversationPath(fixture: AgentRpcFixture): Promise<string> {
	const files = (await readdir(fixture.conversationDir)).filter((name) => name.endsWith(".conversation.jsonl"));
	expect(files).toHaveLength(1);
	const file = files[0];
	if (!file) throw new Error("Expected one Runtime conversation file");
	return join(fixture.conversationDir, file);
}

async function readOwnershipLocks(fixture: AgentRpcFixture): Promise<string[]> {
	return (await readdir(fixture.conversationDir)).filter(
		(name) => name.endsWith(".lock") || name.endsWith(".owner.lock"),
	);
}

async function readLifecycleEvents(path: string): Promise<string[]> {
	return (await readFile(path, "utf8"))
		.trim()
		.split(/\r?\n/u)
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { readonly owner: string; readonly event: string })
		.map((record) => `${record.owner}:${record.event}`);
}

async function waitForDifferentPid(path: string, previousPid: number): Promise<number> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const pid = await readPid(path);
		if (pid !== undefined && pid !== previousPid) return pid;
		await delay(25);
	}
	throw new Error(`Timed out waiting for replacement MCP PID: ${path}`);
}

async function waitForPid(path: string): Promise<number> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const pid = await readPid(path);
		if (pid !== undefined) return pid;
		await delay(25);
	}
	throw new Error(`Timed out waiting for MCP PID: ${path}`);
}

async function readPid(path: string): Promise<number | undefined> {
	try {
		const pid = Number.parseInt((await readFile(path, "utf8")).trim(), 10);
		return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
	} catch {
		return undefined;
	}
}

async function waitForProcessExit(pid: number): Promise<boolean> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		if (!isProcessAlive(pid)) {
			await delay(100);
			return true;
		}
		await delay(25);
	}
	return !isProcessAlive(pid);
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
