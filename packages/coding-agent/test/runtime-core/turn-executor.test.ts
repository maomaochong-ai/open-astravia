import type { RuntimeSession } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import {
	type CodingAgentTurnExecutor,
	type CodingAgentTurnRetryEvent,
	createCodingAgentTurnExecutor,
	createCodingAgentTurnRetryController,
} from "../../src/public-api/runtime/turn.js";

describe("Coding Agent Turn executor", () => {
	it("executes an Extension command without starting a model turn", async () => {
		const prompt = vi.fn(async () => ({ status: "completed" }));
		const commandHost = {
			throwIfExtensionCommand: vi.fn(),
			tryExecute: vi.fn(async () => true),
		};
		const executor = createExecutor({ prompt, commandHost });

		await executor.prompt("/compact");

		expect(commandHost.tryExecute).toHaveBeenCalledWith("/compact");
		expect(prompt).not.toHaveBeenCalled();
	});

	it("retries a retryable failed turn through the active session retry operation", async () => {
		const events: CodingAgentTurnRetryEvent[] = [];
		const prompt = vi.fn(async () => ({ status: "failed", error: { message: "503 service unavailable" } }));
		const retryTurn = vi.fn(async () => ({ status: "completed" }));
		const executor = createExecutor({
			prompt,
			retryTurn,
			retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
			onRetryEvent: (event) => events.push(event),
		});

		await executor.prompt("hello");

		expect(prompt).toHaveBeenCalledWith({ text: "hello", images: undefined, streamingBehavior: undefined });
		expect(retryTurn).toHaveBeenCalledTimes(1);
		expect(events.map((event) => event.type)).toEqual(["auto_retry_start", "auto_retry_end"]);
	});

	it("uses structured retryability instead of parsing the error message", async () => {
		const retryablePrompt = vi.fn(async () => ({
			status: "failed",
			error: {
				code: "AI_STREAM_PROTOCOL_FAILED",
				message: "Stream ended without provider events",
				retryable: true,
			},
		}));
		const retryableRetry = vi.fn(async () => ({ status: "completed" }));
		const retryableExecutor = createExecutor({
			prompt: retryablePrompt,
			retryTurn: retryableRetry,
			retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
		});

		await retryableExecutor.prompt("hello");
		expect(retryableRetry).toHaveBeenCalledTimes(1);

		const permanentRetry = vi.fn(async () => ({ status: "completed" }));
		const permanentExecutor = createExecutor({
			prompt: async () => ({
				status: "failed",
				error: { code: "AI_INVALID_REQUEST", message: "503 appears in user data", retryable: false },
			}),
			retryTurn: permanentRetry,
			retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
		});

		await expect(permanentExecutor.prompt("hello")).rejects.toThrow("503 appears in user data");
		expect(permanentRetry).not.toHaveBeenCalled();
	});

	it("retries Agent Core completed results whose assistant stop reason is error", async () => {
		const events: CodingAgentTurnRetryEvent[] = [];
		const prompt = vi.fn(async () => ({
			status: "completed",
			stopReason: "error",
			messages: [
				{
					role: "assistant",
					stopReason: "error",
					errorMessage: "503 service unavailable",
				},
			],
		}));
		const retryTurn = vi.fn(async () => ({ status: "completed", stopReason: "stop", messages: [] }));
		const executor = createExecutor({
			prompt,
			retryTurn,
			retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
			onRetryEvent: (event) => events.push(event),
		});

		await executor.prompt("hello");

		expect(retryTurn).toHaveBeenCalledTimes(1);
		expect(events.map((event) => event.type)).toEqual(["auto_retry_start", "auto_retry_end"]);
	});

	it("allows Print hosts to preserve terminal model errors without throwing", async () => {
		const prompt = vi.fn(async () => ({
			status: "completed",
			stopReason: "error",
			messages: [{ role: "assistant", stopReason: "error", errorMessage: "401 unauthorized" }],
		}));
		const executor = createExecutor({ prompt });

		await expect(executor.prompt("hello", { throwOnFailure: false })).resolves.toBeUndefined();
	});

	it("routes streaming input without treating it as an Extension command", async () => {
		const prompt = vi.fn(async () => ({ status: "completed" }));
		const commandHost = {
			throwIfExtensionCommand: vi.fn(),
			tryExecute: vi.fn(async () => false),
		};
		const executor = createExecutor({ prompt, commandHost });

		await executor.prompt("more", { streamingBehavior: "followUp" });

		expect(commandHost.throwIfExtensionCommand).toHaveBeenCalledWith("more");
		expect(commandHost.tryExecute).not.toHaveBeenCalled();
		expect(prompt).toHaveBeenCalledWith({
			text: "more",
			images: undefined,
			streamingBehavior: "followUp",
		});
	});

	it("allows a concurrent prompt receipt while the active Turn is still running", async () => {
		let completeInitial!: (value: { status: string }) => void;
		const retryController = createCodingAgentTurnRetryController({
			readSettings: () => ({ enabled: true, maxRetries: 1, baseDelayMs: 0 }),
			setEnabled: vi.fn(),
			emit: vi.fn(),
		});
		const activeTurn = retryController.run(
			() =>
				new Promise<{ status: string }>((resolve) => {
					completeInitial = resolve;
				}),
			async () => ({ status: "completed" }),
			readFailure,
		);
		await Promise.resolve();

		await expect(
			retryController.run(
				async () => ({ status: "queued" }),
				async () => ({ status: "completed" }),
				readFailure,
			),
		).resolves.toEqual({ status: "queued" });

		completeInitial({ status: "completed" });
		await expect(activeTurn).resolves.toEqual({ status: "completed" });
	});

	it("keeps cancellation sticky when requested before retry backoff is installed", async () => {
		const retryTurn = vi.fn(async () => ({ status: "completed" }));
		const events: CodingAgentTurnRetryEvent[] = [];
		let retryController: ReturnType<typeof createCodingAgentTurnRetryController>;
		retryController = createCodingAgentTurnRetryController({
			readSettings: () => ({ enabled: true, maxRetries: 1, baseDelayMs: 10 }),
			setEnabled: vi.fn(),
			emit: (event) => {
				events.push(event);
				if (event.type === "auto_retry_start") retryController.abortRetry();
			},
		});

		const result = await retryController.run(
			async () => ({ status: "failed", error: { message: "503 unavailable", retryable: true } }),
			retryTurn,
			readFailure,
		);

		expect(result).toMatchObject({ status: "failed" });
		expect(retryTurn).not.toHaveBeenCalled();
		expect(events.map((event) => event.type)).toEqual(["auto_retry_start", "auto_retry_end"]);
		expect(events.at(-1)).toMatchObject({ success: false, failure: { code: "RETRY_CANCELLED" } });
	});

	it("uses provider retryAfter as the minimum backoff", async () => {
		const events: CodingAgentTurnRetryEvent[] = [];
		let retryController: ReturnType<typeof createCodingAgentTurnRetryController>;
		retryController = createCodingAgentTurnRetryController({
			readSettings: () => ({ enabled: true, maxRetries: 1, baseDelayMs: 2_000, maxDelayMs: 60_000 }),
			setEnabled: vi.fn(),
			emit: (event) => {
				events.push(event);
				if (event.type === "auto_retry_start") retryController.abortRetry();
			},
		});

		await retryController.run(
			async () => ({
				status: "failed",
				error: { message: "temporarily unavailable", retryable: true, details: { retryAfterMs: 5_000 } },
			}),
			async () => ({ status: "completed" }),
			readFailure,
		);

		expect(events[0]).toMatchObject({ type: "auto_retry_start", delayMs: 5_000 });
	});

	it("does not start a retry when provider retryAfter exceeds the configured wait ceiling", async () => {
		const retryTurn = vi.fn(async () => ({ status: "completed" }));
		const retryController = createCodingAgentTurnRetryController({
			readSettings: () => ({ enabled: true, maxRetries: 3, baseDelayMs: 2_000, maxDelayMs: 60_000 }),
			setEnabled: vi.fn(),
			emit: vi.fn(),
		});

		await retryController.run(
			async () => ({
				status: "failed",
				error: {
					message: "521 origin unavailable",
					retryable: true,
					details: { retryAfterMs: 120_000 },
				},
			}),
			retryTurn,
			readFailure,
		);

		expect(retryTurn).not.toHaveBeenCalled();
	});
});

function readFailure(value: unknown) {
	if (typeof value !== "object" || value === null || Reflect.get(value, "status") !== "failed") return undefined;
	const error = Reflect.get(value, "error") as {
		message: string;
		retryable: boolean;
		details?: { retryAfterMs?: number };
	};
	return { code: "TEST_FAILURE", ...error };
}

interface CreateExecutorOptions {
	readonly prompt: (input: unknown) => Promise<unknown>;
	readonly retryTurn?: () => Promise<unknown>;
	readonly commandHost?: {
		readonly throwIfExtensionCommand: (text: string) => void;
		readonly tryExecute: (text: string) => Promise<boolean>;
	};
	readonly retry?: { readonly enabled: boolean; readonly maxRetries: number; readonly baseDelayMs: number };
	readonly onRetryEvent?: (event: CodingAgentTurnRetryEvent) => void;
}

function createExecutor(options: CreateExecutorOptions): CodingAgentTurnExecutor {
	const session = {
		prompt: options.prompt,
		retry: options.retryTurn ?? (async () => ({ status: "completed" })),
	} as unknown as RuntimeSession;
	const retryController = createCodingAgentTurnRetryController({
		readSettings: () => options.retry ?? { enabled: false, maxRetries: 0, baseDelayMs: 0 },
		setEnabled: vi.fn(),
		emit: options.onRetryEvent ?? vi.fn(),
	});
	return createCodingAgentTurnExecutor({
		sessionHost: {
			startActiveSessionOperation: (operation) => operation(session),
		},
		retryController,
		commandHost: options.commandHost,
	});
}
