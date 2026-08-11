import { describe, expect, it, vi } from "vitest";
import {
	RUNTIME_CANARY_FIRST_PROMPT,
	RUNTIME_CANARY_MCP_PROMPT,
	RUNTIME_CANARY_QUESTION,
	RUNTIME_CANARY_QUESTION_PROMPT,
	RUNTIME_CANARY_RESTART_PROMPT,
	RUNTIME_CANARY_SECOND_PROMPT,
} from "./contracts.js";
import {
	runRuntimeCanaryConversation,
	runRuntimeCanaryRestartedConversation,
	scheduleRuntimeCanaryQuit,
	startRuntimeCanaryConsumers,
	startRuntimeCanaryQuestion,
} from "./runner.js";

const sessionId = "00000000-0000-4000-8000-000000000001";
const createOperationId = "00000000-0000-4000-8000-000000000002";
const continueOperationId = "00000000-0000-4000-8000-000000000003";
const questionOperationId = "00000000-0000-4000-8000-000000000004";
const interactionId = "00000000-0000-4000-8000-000000000005";
const cwd = "C:/runtime-canary/workspace";
const sessionPath = `${cwd}/.vetta/sessions/session.jsonl`;

describe("Runtime Canary runner", () => {
	it("drives create, continue, list, question and abort through existing Debug capabilities", async () => {
		const invokeDebug = vi.fn(async (debugId: string, input: unknown) => {
			if (debugId === "conversation.create") {
				return completed(createOperationId, "DESKTOP_PROCESS_CANARY_FIRST", 2);
			}
			if (debugId === "conversation.list") return [{ sessionPath, cwd }];
			if (debugId === "conversation.abort") {
				return { operationId: questionOperationId, sessionPath, status: "aborted" };
			}
			const prompt = (input as { prompt?: string }).prompt;
			if (prompt === RUNTIME_CANARY_SECOND_PROMPT) {
				return completed(continueOperationId, "DESKTOP_PROCESS_CANARY_SECOND", 4);
			}
			if (prompt === RUNTIME_CANARY_QUESTION_PROMPT) {
				return {
					operationId: questionOperationId,
					sessionId,
					sessionPath,
					cwd,
					status: "input_required",
					interaction: {
						id: interactionId,
						type: "ask_user_question",
						questions: [{ question: RUNTIME_CANARY_QUESTION }],
					},
				};
			}
			throw new Error(`Unexpected Debug call: ${debugId}`);
		});

		await expect(
			runRuntimeCanaryConversation(invokeDebug, {
				cwd,
				modelKey: "runtime-canary/runtime-canary-model",
			}),
		).resolves.toEqual({ sessionId, sessionPath, questionOperationId });
		expect(invokeDebug).toHaveBeenCalledTimes(5);
		expect(invokeDebug.mock.calls[0]?.[1]).toMatchObject({ prompt: RUNTIME_CANARY_FIRST_PROMPT });
	});

	it("validates the graceful quit acknowledgement", async () => {
		const invokeDebug = vi.fn(async () => ({ status: "scheduled", delayMs: 75 }));
		await expect(scheduleRuntimeCanaryQuit(invokeDebug)).resolves.toBe(75);
	});

	it("continues the same session and MCP tool loop after a Desktop process restart", async () => {
		const invokeDebug = vi.fn(async (debugId: string, input: unknown) => {
			if (debugId === "conversation.list") return [{ sessionPath, cwd }];
			const prompt = (input as { prompt?: string }).prompt;
			if (prompt === RUNTIME_CANARY_RESTART_PROMPT) {
				return completed(continueOperationId, "DESKTOP_PROCESS_CANARY_RESTARTED", 6);
			}
			if (prompt === RUNTIME_CANARY_MCP_PROMPT) {
				return completed(questionOperationId, "DESKTOP_PROCESS_CANARY_MCP", 10);
			}
			throw new Error(`Unexpected Debug call: ${debugId}`);
		});

		await expect(
			runRuntimeCanaryRestartedConversation(invokeDebug, {
				sessionId,
				sessionPath,
				cwd,
				modelKey: "runtime-canary/runtime-canary-model",
			}),
		).resolves.toEqual({ sessionId, sessionPath, messageCount: 10 });
		expect(invokeDebug).toHaveBeenCalledTimes(3);
	});

	it("resolves a pending question recovered from the first Desktop process before continuing", async () => {
		const invokeDebug = vi.fn(async (debugId: string, input: unknown) => {
			if (debugId === "conversation.answer") {
				return completed(questionOperationId, "DESKTOP_PROCESS_CANARY_RESTARTED", 8);
			}
			if (debugId === "conversation.list") return [{ sessionPath, cwd }];
			const prompt = (input as { prompt?: string }).prompt;
			if (prompt === RUNTIME_CANARY_RESTART_PROMPT) {
				return {
					operationId: questionOperationId,
					sessionId,
					sessionPath,
					cwd,
					status: "input_required",
					interaction: {
						id: interactionId,
						type: "ask_user_question",
						questions: [{ question: RUNTIME_CANARY_QUESTION }],
					},
				};
			}
			if (prompt === RUNTIME_CANARY_MCP_PROMPT) {
				return completed(continueOperationId, "DESKTOP_PROCESS_CANARY_MCP", 12);
			}
			throw new Error(`Unexpected Debug call: ${debugId}`);
		});

		await expect(
			runRuntimeCanaryRestartedConversation(invokeDebug, {
				sessionId,
				sessionPath,
				cwd,
				modelKey: "runtime-canary/runtime-canary-model",
			}),
		).resolves.toEqual({ sessionId, sessionPath, messageCount: 12 });
		expect(invokeDebug).toHaveBeenCalledTimes(4);
		expect(invokeDebug.mock.calls[1]).toEqual([
			"conversation.answer",
			{ operationId: questionOperationId, interactionId, cancelled: true },
		]);
	});

	it("accepts completion when question cancellation wins the abort race", async () => {
		const invokeDebug = createCompletedAbortInvoker();
		await expect(
			runRuntimeCanaryConversation(invokeDebug, {
				cwd,
				modelKey: "runtime-canary/runtime-canary-model",
			}),
		).resolves.toMatchObject({ sessionId, sessionPath, questionOperationId });
	});

	it("starts a pending interaction and background consumers without bypassing Debug CLI contracts", async () => {
		const invokeDebug = vi.fn(async (debugId: string) => {
			if (debugId === "conversation.continue") {
				return {
					operationId: questionOperationId,
					sessionId,
					sessionPath,
					cwd,
					status: "input_required",
					interaction: {
						id: interactionId,
						type: "ask_user_question",
						questions: [{ question: RUNTIME_CANARY_QUESTION }],
					},
				};
			}
			return {
				schedulerTaskId: "scheduler-task",
				schedulerSessionId: "scheduler-session",
				schedulerSessionPath: "C:/sessions/scheduler.jsonl",
				batchProjectId: "batch-project",
				batchActiveTaskId: "batch-active",
				batchQueuedTaskId: "batch-queued",
				batchSessionId: "batch-session",
				batchSessionPath: "C:/sessions/batch.jsonl",
			};
		});

		await expect(
			startRuntimeCanaryQuestion(invokeDebug, {
				sessionPath,
				modelKey: "runtime-canary/runtime-canary-model",
			}),
		).resolves.toEqual({ operationId: questionOperationId, sessionPath });
		await expect(
			startRuntimeCanaryConsumers(invokeDebug, {
				workspace: cwd,
				modelKey: "runtime-canary/runtime-canary-model",
				batchSourceDirectories: ["C:/source-one", "C:/source-two"],
			}),
		).resolves.toMatchObject({
			schedulerSessionId: "scheduler-session",
			batchSessionId: "batch-session",
			batchQueuedTaskId: "batch-queued",
		});
		expect(invokeDebug).toHaveBeenCalledTimes(2);
	});
});

function completed(operationId: string, assistantText: string, messageCount: number) {
	return {
		operationId,
		sessionId,
		sessionPath,
		cwd,
		status: "completed",
		stopReason: "stop",
		assistantText,
		messageCount,
	};
}

function createCompletedAbortInvoker() {
	return vi.fn(async (debugId: string, input: unknown) => {
		if (debugId === "conversation.create") {
			return completed(createOperationId, "DESKTOP_PROCESS_CANARY_FIRST", 2);
		}
		if (debugId === "conversation.list") return [{ sessionPath, cwd }];
		if (debugId === "conversation.abort") return completed(questionOperationId, "", 6);
		const prompt = (input as { prompt?: string }).prompt;
		if (prompt === RUNTIME_CANARY_SECOND_PROMPT) {
			return completed(continueOperationId, "DESKTOP_PROCESS_CANARY_SECOND", 4);
		}
		if (prompt === RUNTIME_CANARY_QUESTION_PROMPT) {
			return {
				operationId: questionOperationId,
				sessionId,
				sessionPath,
				cwd,
				status: "input_required",
				interaction: {
					id: interactionId,
					type: "ask_user_question",
					questions: [{ question: RUNTIME_CANARY_QUESTION }],
				},
			};
		}
		throw new Error(`Unexpected Debug call: ${debugId}`);
	});
}
