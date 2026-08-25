import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	AgentRpcProcess,
	createAgentRpcFixture,
	createAgentRpcProcessEnv,
	waitForRpcProcessPid,
} from "./support/agent-rpc-test-process.js";

describe("Agent RPC process test fixture", () => {
	it("isolates user configuration while preserving required process launch variables", async () => {
		const fixture = await createAgentRpcFixture();
		try {
			const env = createAgentRpcProcessEnv(fixture, {
				baseEnv: {
					ComSpec: "C:\\Windows\\System32\\cmd.exe",
					HOME: "C:\\contaminated-home",
					PATH: "C:\\tools",
					SECRET_FROM_PARENT: "must-not-pass-through",
					VETTA_HOME: "C:\\contaminated-vetta-home",
				},
				overrides: { TEST_OVERRIDE: "enabled" },
			});

			expect(env).toMatchObject({
				APPDATA: join(fixture.root, "app-data"),
				CI: "1",
				ComSpec: "C:\\Windows\\System32\\cmd.exe",
				HOME: fixture.root,
				LOCALAPPDATA: join(fixture.root, "local-app-data"),
				NO_COLOR: "1",
				PATH: "C:\\tools",
				TEST_OVERRIDE: "enabled",
				USERPROFILE: fixture.root,
				VETTA_CODING_AGENT_DIR: fixture.agentDir,
				VETTA_HOME: join(fixture.root, "home"),
			});
			expect(env.SECRET_FROM_PARENT).toBeUndefined();
		} finally {
			await fixture.dispose();
		}
	});

	it("reports child exit diagnostics instead of waiting for the full MCP timeout", async () => {
		const fixture = await createAgentRpcFixture();
		const child = spawn(
			process.execPath,
			["-e", "process.stderr.write('fixture-mcp-start-failed'); setTimeout(() => process.exit(23), 50);"],
			{ stdio: "pipe", windowsHide: true },
		);
		const processHandle = new AgentRpcProcess(child);
		try {
			await expect(
				waitForRpcProcessPid(processHandle, join(fixture.root, "missing-mcp.pid"), { timeoutMs: 2_000 }),
			).rejects.toThrow(/RPC process exited.*exitCode=23.*fixture-mcp-start-failed/su);
			await expect(processHandle.close()).resolves.toBe(23);
		} finally {
			await processHandle.close();
			await fixture.dispose();
		}
	});
});
