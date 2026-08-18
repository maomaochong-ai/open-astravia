import type { RuntimeSessionContextDeliveryController } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import type { CodingAgentTurnRetryEvent } from "../../src/execution/turn/contracts.js";
import { readCodingAgentTurnFailure } from "../../src/execution/turn/turn-executor.js";
import { CodingAgentSessionTurnRetryController } from "../../src/execution/turn/turn-retry-controller.js";
import type { HostBashExecutor } from "../../src/host/command-execution/index.js";
import { CodingAgentRpcBashCapability } from "../../src/rpc/rpc-bash-capability.js";

describe("Coding Agent RPC capabilities", () => {
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
		const result = await controller.run(retry, retry, readCodingAgentTurnFailure);

		expect(result).toEqual({ status: "completed" });
		expect(retry).toHaveBeenCalledTimes(2);
		expect(events).toEqual([
			{
				type: "auto_retry_start",
				attempt: 1,
				maxAttempts: 2,
				delayMs: 0,
				errorMessage: "503 service unavailable",
				failure: {
					code: "TURN_FAILED",
					message: "503 service unavailable",
					retryable: true,
					origin: "runtime",
				},
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

		await controller.run(execute, execute, readCodingAgentTurnFailure);

		expect(execute).toHaveBeenCalledOnce();
	});
});
