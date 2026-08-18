import { z } from "zod";
import {
	RUNTIME_CANARY_FIRST_PROMPT,
	RUNTIME_CANARY_MCP_PROMPT,
	RUNTIME_CANARY_QUESTION,
	RUNTIME_CANARY_QUESTION_PROMPT,
	RUNTIME_CANARY_RESTART_PROMPT,
	RUNTIME_CANARY_SECOND_PROMPT,
	type RuntimeCanaryConsumers,
	runtimeCanaryConsumersSchema,
} from "./contracts.js";

const completedOperationSchema = z
	.object({
		operationId: z.uuid(),
		sessionId: z.string().min(1),
		sessionPath: z.string().min(1),
		cwd: z.string().min(1),
		status: z.literal("completed"),
		assistantText: z.string(),
		messageCount: z.number().int().nonnegative(),
	})
	.loose();

const inputRequiredOperationSchema = z
	.object({
		operationId: z.uuid(),
		sessionId: z.string().min(1),
		sessionPath: z.string().min(1),
		cwd: z.string().min(1),
		status: z.literal("input_required"),
		interaction: z
			.object({
				id: z.uuid(),
				type: z.literal("ask_user_question"),
				questions: z.array(z.object({ question: z.string() }).loose()).min(1),
			})
			.loose(),
	})
	.loose();

const terminalOperationSchema = z.discriminatedUnion("status", [
	z
		.object({
			operationId: z.uuid(),
			sessionPath: z.string().min(1),
			status: z.literal("aborted"),
		})
		.loose(),
	completedOperationSchema,
]);
const resumableOperationSchema = z.discriminatedUnion("status", [
	completedOperationSchema,
	inputRequiredOperationSchema,
]);

const sessionSummarySchema = z.object({ sessionPath: z.string().min(1), cwd: z.string().min(1) }).loose();
const quitResultSchema = z.object({ status: z.literal("scheduled"), delayMs: z.number().int().positive() }).strict();

export type RuntimeCanaryDebugInvoker = (debugId: string, input: unknown) => Promise<unknown>;

export interface RuntimeCanaryConversationResult {
	readonly sessionId: string;
	readonly sessionPath: string;
	readonly questionOperationId: string;
}

export interface RuntimeCanaryPendingQuestion {
	readonly operationId: string;
	readonly sessionPath: string;
}

export interface RuntimeCanaryRestartResult {
	readonly sessionId: string;
	readonly sessionPath: string;
	readonly messageCount: number;
}

export async function runRuntimeCanaryConversation(
	invokeDebug: RuntimeCanaryDebugInvoker,
	options: { readonly cwd: string; readonly modelKey: string },
): Promise<RuntimeCanaryConversationResult> {
	const common = {
		executionMode: "full-access" as const,
		modelKey: options.modelKey,
		timeoutMs: 30_000,
	};
	const created = completedOperationSchema.parse(
		await invokeDebug("conversation.create", {
			cwd: options.cwd,
			prompt: RUNTIME_CANARY_FIRST_PROMPT,
			...common,
		}),
	);
	if (created.assistantText !== "DESKTOP_PROCESS_CANARY_FIRST") {
		throw new Error(`Unexpected first Runtime Canary response: ${created.assistantText}`);
	}

	const continued = completedOperationSchema.parse(
		await invokeDebug("conversation.continue", {
			sessionPath: created.sessionPath,
			prompt: RUNTIME_CANARY_SECOND_PROMPT,
			...common,
		}),
	);
	if (
		continued.sessionId !== created.sessionId ||
		continued.sessionPath !== created.sessionPath ||
		continued.assistantText !== "DESKTOP_PROCESS_CANARY_SECOND"
	) {
		throw new Error("Runtime Canary continuation did not preserve the session identity and response");
	}

	const sessions = z
		.array(sessionSummarySchema)
		.parse(await invokeDebug("conversation.list", { cwd: options.cwd, limit: 20 }));
	if (!sessions.some((session) => session.sessionPath === created.sessionPath && session.cwd === options.cwd)) {
		throw new Error("Runtime Canary session was not returned by conversation.list");
	}

	const question = await startRuntimeCanaryQuestion(invokeDebug, {
		sessionPath: created.sessionPath,
		modelKey: options.modelKey,
		timeoutMs: common.timeoutMs,
	});

	const terminal = terminalOperationSchema.parse(
		await invokeDebug("conversation.abort", { operationId: question.operationId }),
	);
	if (terminal.operationId !== question.operationId || terminal.sessionPath !== created.sessionPath) {
		throw new Error("Runtime Canary abort did not preserve the operation and session identity");
	}

	return {
		sessionId: created.sessionId,
		sessionPath: created.sessionPath,
		questionOperationId: question.operationId,
	};
}

export async function runRuntimeCanaryRestartedConversation(
	invokeDebug: RuntimeCanaryDebugInvoker,
	options: {
		readonly sessionId: string;
		readonly sessionPath: string;
		readonly cwd: string;
		readonly modelKey: string;
	},
): Promise<RuntimeCanaryRestartResult> {
	const common = {
		executionMode: "full-access" as const,
		modelKey: options.modelKey,
		timeoutMs: 30_000,
	};
	const restartAttempt = resumableOperationSchema.parse(
		await invokeDebug("conversation.continue", {
			sessionPath: options.sessionPath,
			prompt: RUNTIME_CANARY_RESTART_PROMPT,
			...common,
		}),
	);
	if (
		restartAttempt.status === "input_required" &&
		!restartAttempt.interaction.questions.some((item) => item.question === RUNTIME_CANARY_QUESTION)
	) {
		throw new Error("Restarted Runtime Canary recovered an unexpected pending interaction");
	}
	const restarted =
		restartAttempt.status === "input_required"
			? completedOperationSchema.parse(
					await invokeDebug("conversation.answer", {
						operationId: restartAttempt.operationId,
						interactionId: restartAttempt.interaction.id,
						cancelled: true,
					}),
				)
			: restartAttempt;
	if (
		restarted.sessionId !== options.sessionId ||
		restarted.sessionPath !== options.sessionPath ||
		restarted.cwd !== options.cwd ||
		restarted.assistantText !== "DESKTOP_PROCESS_CANARY_RESTARTED"
	) {
		throw new Error("Runtime Canary process restart did not preserve the session identity, cwd and response");
	}

	const mcp = completedOperationSchema.parse(
		await invokeDebug("conversation.continue", {
			sessionPath: options.sessionPath,
			prompt: RUNTIME_CANARY_MCP_PROMPT,
			...common,
		}),
	);
	if (
		mcp.sessionId !== options.sessionId ||
		mcp.sessionPath !== options.sessionPath ||
		mcp.assistantText !== "DESKTOP_PROCESS_CANARY_MCP"
	) {
		throw new Error("Runtime Canary MCP continuation did not preserve the restarted session identity and response");
	}

	const sessions = z
		.array(sessionSummarySchema)
		.parse(await invokeDebug("conversation.list", { cwd: options.cwd, limit: 20 }));
	if (!sessions.some((session) => session.sessionPath === options.sessionPath && session.cwd === options.cwd)) {
		throw new Error("Restarted Runtime Canary session was not returned by conversation.list");
	}

	return {
		sessionId: mcp.sessionId,
		sessionPath: mcp.sessionPath,
		messageCount: mcp.messageCount,
	};
}

export async function startRuntimeCanaryQuestion(
	invokeDebug: RuntimeCanaryDebugInvoker,
	options: { readonly sessionPath: string; readonly modelKey: string; readonly timeoutMs?: number },
): Promise<RuntimeCanaryPendingQuestion> {
	const question = inputRequiredOperationSchema.parse(
		await invokeDebug("conversation.continue", {
			sessionPath: options.sessionPath,
			prompt: RUNTIME_CANARY_QUESTION_PROMPT,
			executionMode: "full-access",
			modelKey: options.modelKey,
			timeoutMs: options.timeoutMs ?? 30_000,
		}),
	);
	if (
		question.sessionPath !== options.sessionPath ||
		!question.interaction.questions.some((item) => item.question === RUNTIME_CANARY_QUESTION)
	) {
		throw new Error("Runtime Canary did not receive the expected ask_user_question interaction");
	}
	return { operationId: question.operationId, sessionPath: question.sessionPath };
}

export async function startRuntimeCanaryConsumers(
	invokeDebug: RuntimeCanaryDebugInvoker,
	options: {
		readonly workspace: string;
		readonly modelKey: string;
		readonly batchSourceDirectories: readonly [string, string];
	},
): Promise<RuntimeCanaryConsumers> {
	return runtimeCanaryConsumersSchema.parse(
		await invokeDebug("runtime-canary.consumers.start", {
			workspace: options.workspace,
			modelKey: options.modelKey,
			batchSourceDirectories: options.batchSourceDirectories,
		}),
	);
}

export async function scheduleRuntimeCanaryQuit(invokeDebug: RuntimeCanaryDebugInvoker): Promise<number> {
	const result = quitResultSchema.parse(await invokeDebug("lifecycle.quit", {}));
	return result.delayMs;
}
