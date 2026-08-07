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
});

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
