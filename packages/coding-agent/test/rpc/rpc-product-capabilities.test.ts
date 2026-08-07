import type { RuntimeSessionContextDeliveryController } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import type { HostBashExecutor } from "../../src/host/command-execution/index.js";
import type { CodingAgentTurnRetryEvent } from "../../src/host/session-execution/contracts.js";
import { CodingAgentSessionTurnRetryController } from "../../src/host/session-execution/turn-retry-controller.js";
import { CodingAgentRpcBashCapability } from "../../src/modes/rpc/rpc-bash-capability.js";

describe("Coding Agent RPC product capabilities", () => {
	it("executes user Bash through the injected host boundary and records the unchanged RPC result", async () => {
		const result = {
			output: "rpc output",
			exitCode: 7,
			cancelled: false,
			truncated: false,
		} as const;
		const executor: HostBashExecutor = {
			execute: vi.fn(async () => result),
			executeWithOperations: vi.fn(async () => result),
		};
		const deliver = vi.fn(async () => {});
		const bash = new CodingAgentRpcBashCapability({
			executor,
			readContextDeliveryController: () => ({ deliver }) as unknown as RuntimeSessionContextDeliveryController,
			readShellCommandPrefix: () => "prefix",
		});

		await expect(bash.execute("command")).resolves.toEqual(result);
		expect(executor.execute).toHaveBeenCalledWith(
			"prefix\ncommand",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(deliver).toHaveBeenCalledWith(
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

	it("retries retryable turn failures without depending on Legacy session state", async () => {
		let enabled = true;
		const events: CodingAgentTurnRetryEvent[] = [];
		const retry = vi
			.fn<() => Promise<{ status: string; error?: { message: string } }>>()
			.mockResolvedValueOnce({ status: "failed", error: { message: "503 service unavailable" } })
			.mockResolvedValueOnce({ status: "completed" });
		const controller = new CodingAgentSessionTurnRetryController({
			readSettings: () => ({ enabled, maxRetries: 2, baseDelayMs: 0 }),
			setEnabled: (value) => {
				enabled = value;
			},
			emit: (event) => events.push(event),
		});

		controller.setAutoRetryEnabled(false);
		expect(enabled).toBe(false);
		controller.setAutoRetryEnabled(true);
		const result = await controller.run(retry, retry, (candidate) => candidate.error?.message);

		expect(result).toEqual({ status: "completed" });
		expect(retry).toHaveBeenCalledTimes(2);
		expect(events).toEqual([
			{
				type: "auto_retry_start",
				attempt: 1,
				maxAttempts: 2,
				delayMs: 0,
				errorMessage: "503 service unavailable",
			},
			{ type: "auto_retry_end", success: true, attempt: 1 },
		]);
	});

	it("does not retry quota exhaustion errors", async () => {
		const execute = vi.fn<() => Promise<{ status: string; error: { message: string } }>>().mockResolvedValue({
			status: "failed",
			error: { message: "429 insufficient quota" },
		});
		const controller = new CodingAgentSessionTurnRetryController({
			readSettings: () => ({ enabled: true, maxRetries: 3, baseDelayMs: 0 }),
			setEnabled: () => {},
			emit: () => {},
		});

		await controller.run(execute, execute, (candidate) => candidate.error?.message);

		expect(execute).toHaveBeenCalledOnce();
	});
});
