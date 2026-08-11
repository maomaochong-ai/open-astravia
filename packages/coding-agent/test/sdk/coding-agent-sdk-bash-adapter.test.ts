import type { RuntimeSession } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { CodingAgentSdkBashAdapter } from "../../src/host/coding-agent-sdk-bash-adapter.js";
import { createHostBashExecutor } from "../../src/host/command-execution/index.js";

describe("CodingAgentSdkBashAdapter", () => {
	it("streams custom Bash operations and persists the result through Session context delivery", async () => {
		const fixture = createSession(false);
		const adapter = new CodingAgentSdkBashAdapter({
			executor: createHostBashExecutor(),
			readShellCommandPrefix: () => "prefix",
		});
		const chunks: string[] = [];

		const result = await adapter.execute(fixture.session, "command", (chunk) => chunks.push(chunk), {
			operations: {
				exec: async (command, cwd, options) => {
					expect(command).toBe("prefix\ncommand");
					expect(cwd).toBe("C:/workspace");
					options.onData(Buffer.from("sdk output"));
					return { exitCode: 0 };
				},
			},
		});

		expect(result).toMatchObject({ output: "sdk output", exitCode: 0, cancelled: false });
		expect(chunks).toEqual(["sdk output"]);
		expect(fixture.deliver).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					type: "vetta.legacy_agent_message",
					modelVisible: true,
					display: true,
				}),
			],
			"record",
		);
	});

	it("queues a result during streaming and flushes it before an identity transition", async () => {
		const fixture = createSession(true);
		const adapter = new CodingAgentSdkBashAdapter({
			executor: createHostBashExecutor(),
			readShellCommandPrefix: () => undefined,
		});

		await adapter.execute(fixture.session, "command", undefined, {
			operations: { exec: async () => ({ exitCode: 0 }) },
		});
		expect(adapter.hasPending("session-1")).toBe(true);
		expect(fixture.deliver).not.toHaveBeenCalled();

		await adapter.quiesce(fixture.session);

		expect(adapter.hasPending("session-1")).toBe(false);
		expect(fixture.deliver).toHaveBeenCalledOnce();
	});

	it("aborts and waits for the active command during identity quiescence", async () => {
		const fixture = createSession(false);
		const adapter = new CodingAgentSdkBashAdapter({
			executor: createHostBashExecutor(),
			readShellCommandPrefix: () => undefined,
		});
		const running = adapter.execute(fixture.session, "command", undefined, {
			operations: {
				exec: async (_command, _cwd, { signal }) =>
					new Promise((_resolve, reject) => {
						signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
					}),
			},
		});
		await vi.waitFor(() => expect(adapter.isRunning).toBe(true));

		await adapter.quiesce(fixture.session);

		await expect(running).resolves.toMatchObject({ cancelled: true });
		expect(adapter.isRunning).toBe(false);
	});
});

function createSession(streaming: boolean) {
	const deliver = vi.fn(async () => {});
	const session = {
		sessionId: "session-1",
		readState: () => ({ isStreaming: streaming }),
		createCoreAssembly: () => ({
			workspaceView: { readWorkingDirectory: () => "C:/workspace" },
			contextDeliveryController: { deliver },
		}),
	} as unknown as RuntimeSession;
	return { deliver, session };
}
