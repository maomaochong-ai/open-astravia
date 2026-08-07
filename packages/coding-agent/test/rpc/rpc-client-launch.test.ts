import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	RpcClient,
	RpcClientError,
	resolveRpcClientProcessLaunch,
	rpcClientErrorFromResponse,
} from "../../src/modes/rpc/rpc-client.js";

describe("RpcClient process launch", () => {
	it("uses the canonical installed RPC executable by default", () => {
		expect(resolveRpcClientProcessLaunch(undefined, ["--mode", "rpc"])).toEqual({
			command: "vetta-agent-rpc",
			args: ["--mode", "rpc"],
		});
	});

	it("preserves explicit JavaScript entry paths for compatibility", () => {
		expect(resolveRpcClientProcessLaunch("custom-agent.js", ["--mode", "rpc"])).toEqual({
			command: "node",
			args: ["custom-agent.js", "--mode", "rpc"],
		});
	});

	it("preserves structured failure metadata when a command rejects", () => {
		const error = rpcClientErrorFromResponse({
			id: "prompt-1",
			type: "response",
			command: "prompt",
			success: false,
			error: "provider failed",
			errorCode: "provider_unavailable",
			phase: "turn",
			recoverability: "continue_session",
		});

		expect(error).toBeInstanceOf(RpcClientError);
		expect(error).toMatchObject({
			message: "provider failed",
			command: "prompt",
			errorCode: "provider_unavailable",
			phase: "turn",
			recoverability: "continue_session",
		});
	});

	it("rejects event waits immediately on process exit and permits an explicit restart", async () => {
		const fixtureDir = await mkdtemp(join(tmpdir(), "rpc-client-exit-"));
		const fixturePath = join(fixtureDir, "exit.mjs");
		await writeFile(fixturePath, "setTimeout(() => process.exit(9), 300);\n", "utf8");
		const client = new RpcClient({ cliPath: fixturePath });

		try {
			await client.start();
			const startedAt = Date.now();
			await expect(client.collectEvents(5_000)).rejects.toMatchObject({
				errorCode: "process_exited",
				phase: "turn",
				recoverability: "restart_session",
			});
			expect(Date.now() - startedAt).toBeLessThan(2_000);

			await client.start();
			await client.stop();
		} finally {
			await client.stop();
			await rm(fixtureDir, { recursive: true, force: true });
		}
	});
});
