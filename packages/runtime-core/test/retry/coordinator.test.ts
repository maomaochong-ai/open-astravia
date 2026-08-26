import { describe, expect, it, vi } from "vitest";
import type { RuntimeFailure } from "../../src/failure-contract.js";
import { createRuntimeObservationPublisher, type RuntimeObservationRecord } from "../../src/observation/index.js";
import {
	ConfigurableRuntimeTurnRetryPolicy,
	type RuntimeRetryDelay,
	RuntimeTurnRetryCoordinator,
	type RuntimeTurnRetryEvent,
} from "../../src/retry/index.js";

describe("RuntimeTurnRetryCoordinator", () => {
	it("retries with exponential backoff and publishes privacy-safe lifecycle observations", async () => {
		const events: RuntimeTurnRetryEvent[] = [];
		const records: RuntimeObservationRecord[] = [];
		const delays: number[] = [];
		const results = [failed("AI_RATE_LIMITED"), failed("AI_RATE_LIMITED"), { status: "completed" }];
		const execute = vi.fn(async () => results.shift());
		const coordinator = createCoordinator({
			settings: { enabled: true, maxRetries: 2, baseDelayMs: 100 },
			events,
			delay: { wait: async (delayMs) => void delays.push(delayMs) },
			records,
		});

		await expect(coordinator.run(execute, execute, readFailure)).resolves.toEqual({ status: "completed" });

		expect(delays).toEqual([100, 200]);
		expect(events.map(({ type }) => type)).toEqual(["auto_retry_start", "auto_retry_start", "auto_retry_end"]);
		expect(records.map(({ token }) => token.id)).toEqual([
			"runtime.retry.lifecycle",
			"runtime.retry.lifecycle",
			"runtime.retry.lifecycle",
		]);
		expect(records[0]).toMatchObject({
			context: { sessionId: "session-1" },
			payload: { phase: "scheduled", failureCode: "AI_RATE_LIMITED", failureOrigin: "provider" },
		});
		expect(JSON.stringify(records)).not.toContain("provider response body");
	});

	it("treats Retry-After as a minimum and stops when it exceeds the configured ceiling", async () => {
		const records: RuntimeObservationRecord[] = [];
		const execute = vi.fn(async () => failed("AI_RATE_LIMITED", 5_000));
		const coordinator = createCoordinator({
			settings: { enabled: true, maxRetries: 3, baseDelayMs: 100, maxDelayMs: 2_000 },
			delay: { wait: async () => expect.unreachable() },
			records,
		});

		await expect(coordinator.run(execute, execute, readFailure)).resolves.toMatchObject({ status: "failed" });
		expect(execute).toHaveBeenCalledOnce();
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			token: { id: "runtime.retry.issue", level: "warning" },
			payload: {
				reason: "retry-after-exceeds-max-delay",
				failureCode: "AI_RATE_LIMITED",
				failureOrigin: "provider",
			},
		});
	});

	it("cancels an active backoff without executing another Turn", async () => {
		let notifyWaiting: (() => void) | undefined;
		const waiting = new Promise<void>((resolve) => {
			notifyWaiting = resolve;
		});
		const delay: RuntimeRetryDelay = {
			wait: (_delayMs, signal) =>
				new Promise((_resolve, reject) => {
					notifyWaiting?.();
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				}),
		};
		const events: RuntimeTurnRetryEvent[] = [];
		const executeInitial = vi.fn(async () => failed("TEMPORARY"));
		const executeRetry = vi.fn(async () => ({ status: "completed" }));
		const coordinator = createCoordinator({
			settings: { enabled: true, maxRetries: 2, baseDelayMs: 1_000 },
			delay,
			events,
		});
		const run = coordinator.run(executeInitial, executeRetry, readFailure);
		await waiting;

		coordinator.abortRetry();

		await expect(run).resolves.toMatchObject({ status: "failed" });
		expect(executeRetry).not.toHaveBeenCalled();
		expect(events.at(-1)).toMatchObject({
			type: "auto_retry_end",
			success: false,
			failure: { code: "RETRY_CANCELLED" },
		});
		expect(coordinator.isRetrying).toBe(false);
	});

	it("allows only one failed operation to own Session retry state", async () => {
		let releaseDelay: (() => void) | undefined;
		let notifyWaiting: (() => void) | undefined;
		const waiting = new Promise<void>((resolve) => {
			notifyWaiting = resolve;
		});
		const delay: RuntimeRetryDelay = {
			wait: () =>
				new Promise<void>((resolve) => {
					releaseDelay = resolve;
					notifyWaiting?.();
				}),
		};
		const records: RuntimeObservationRecord[] = [];
		const coordinator = createCoordinator({
			settings: { enabled: true, maxRetries: 1, baseDelayMs: 1 },
			delay,
			records,
		});
		const first = coordinator.run(
			async () => failed("FIRST"),
			async () => ({ status: "completed" }),
			readFailure,
		);
		await waiting;
		const secondRetry = vi.fn(async () => ({ status: "completed" }));

		await expect(coordinator.run(async () => failed("SECOND"), secondRetry, readFailure)).resolves.toMatchObject({
			status: "failed",
		});
		expect(secondRetry).not.toHaveBeenCalled();
		expect(records.some(({ payload }) => (payload as { reason?: string }).reason === "concurrent-owner")).toBe(true);

		releaseDelay?.();
		await expect(first).resolves.toEqual({ status: "completed" });
	});
});

function createCoordinator(options: {
	readonly settings: {
		readonly enabled: boolean;
		readonly maxRetries: number;
		readonly baseDelayMs: number;
		readonly maxDelayMs?: number;
	};
	readonly delay: RuntimeRetryDelay;
	readonly events?: RuntimeTurnRetryEvent[];
	readonly records?: RuntimeObservationRecord[];
}) {
	return new RuntimeTurnRetryCoordinator({
		policy: new ConfigurableRuntimeTurnRetryPolicy({ readSettings: () => options.settings }),
		delay: options.delay,
		emit: (event) => options.events?.push(event),
		observationPublisher: options.records
			? createRuntimeObservationPublisher({ port: { record: (record) => void options.records?.push(record) } })
			: undefined,
		observationContext: { sessionId: "session-1" },
	});
}

function failed(code: string, retryAfterMs?: number) {
	return {
		status: "failed",
		error: {
			code,
			message: "provider response body must not enter observations",
			retryable: true,
			origin: "provider" as const,
			...(retryAfterMs === undefined ? {} : { details: { retryAfterMs } }),
		},
	};
}

function readFailure(value: unknown): RuntimeFailure | undefined {
	if (!value || typeof value !== "object" || !("error" in value)) return undefined;
	return value.error as RuntimeFailure;
}
