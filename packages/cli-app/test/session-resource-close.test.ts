import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type AgentRpcExecutable,
	buildAgentRpcExecutable,
	createAgentRpcFixture,
	readSessionFile,
	startAgentRpc,
} from "./support/agent-rpc-test-process.js";
import {
	startOpenAiResponsesTestServer,
	textResponseEvents,
	toolCallResponseEvents,
} from "./support/openai-responses-test-server.js";

let executable: AgentRpcExecutable;

beforeAll(async () => {
	executable = await buildAgentRpcExecutable();
});

afterAll(async () => {
	await executable.dispose();
});

describe("Runtime Session resource close", () => {
	it("quiets background work before new_session publishes the target identity", async () => {
		const server = await startOpenAiResponsesTestServer((_request, index) =>
			index === 0
				? {
						kind: "events",
						events: toolCallResponseEvents(process.platform === "win32" ? "shell" : "bash", {
							command: heldProcessCommand("transition-background.pid"),
							run_in_background: true,
						}),
					}
				: { kind: "events", events: textResponseEvents(index === 1 ? "Task accepted." : "Recovered.") },
		);
		const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		const agentProcess = startAgentRpc(executable, fixture);
		try {
			const sourcePath = readSessionFile(await agentProcess.request("transition-source", "get_state"));
			const turnMark = agentProcess.mark();
			await agentProcess.request("transition-background", "prompt", { message: "Start the background task" });
			await agentProcess.waitFor((frame) => frame.type === "agent_end", turnMark, 10_000);
			const pid = await waitForPid(join(fixture.workspace, "transition-background.pid"));
			expect(isProcessAlive(pid)).toBe(true);

			await agentProcess.request("transition-new", "new_session");
			const targetPath = readSessionFile(await agentProcess.request("transition-target", "get_state"));
			expect(isProcessAlive(pid)).toBe(false);
			expect(targetPath).not.toBe(sourcePath);
			expect(existsSync(`${sourcePath}.owner.lock`)).toBe(false);
			expect(existsSync(`${targetPath}.owner.lock`)).toBe(true);
			await new Promise<void>((resolve) => setTimeout(resolve, 200));
			expect(server.requests).toHaveLength(2);

			const recoveryMark = agentProcess.mark();
			await agentProcess.request("transition-recovery", "prompt", { message: "Continue in the new session" });
			await agentProcess.waitFor((frame) => frame.type === "agent_end", recoveryMark, 10_000);
			expect(server.requests).toHaveLength(3);
		} finally {
			await agentProcess.close();
			await fixture.dispose();
			await server.dispose();
		}
	}, 30_000);

	it("waits for a background Bash process to exit before the Vetta CLI releases ownership", async () => {
		const server = await startOpenAiResponsesTestServer((_request, index) =>
			index === 0
				? {
						kind: "events",
						events: toolCallResponseEvents(process.platform === "win32" ? "shell" : "bash", {
							command: heldProcessCommand("background.pid"),
							run_in_background: true,
						}),
					}
				: { kind: "events", events: textResponseEvents("Background task started.") },
		);
		const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		const agentProcess = startAgentRpc(executable, fixture);
		try {
			const mark = agentProcess.mark();
			await agentProcess.request("background-close", "prompt", { message: "Start the background task" });
			await agentProcess.waitFor((frame) => frame.type === "agent_end", mark, 10_000);
			const pidPath = join(fixture.workspace, "background.pid");
			const pid = await waitForPid(pidPath);
			expect(isProcessAlive(pid)).toBe(true);

			await expect(agentProcess.close()).resolves.toBe(0);
			expect(isProcessAlive(pid)).toBe(false);
			expect(await countOwnershipLocks(fixture.conversationDir)).toBe(0);
		} finally {
			await agentProcess.close();
			await fixture.dispose();
			await server.dispose();
		}
	}, 30_000);
});

function heldProcessCommand(relativePidPath: string): string {
	if (process.platform === "win32") {
		return `$PID | Set-Content -LiteralPath '${relativePidPath}' -Encoding ascii; Start-Sleep -Seconds 60`;
	}
	return `printf '%s' "$$" > '${relativePidPath}'; sleep 60`;
}

async function waitForPid(path: string): Promise<number> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		try {
			const pid = Number.parseInt((await readFile(path, "utf8")).trim(), 10);
			if (Number.isSafeInteger(pid) && pid > 0) return pid;
		} catch {
			// The command has not written its PID yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Timed out waiting for background PID file: ${path}`);
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function countOwnershipLocks(directory: string): Promise<number> {
	return (await readdir(directory)).filter((name) => name.endsWith(".lock") || name.endsWith(".owner.lock")).length;
}
