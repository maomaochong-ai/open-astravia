import { randomUUID } from "node:crypto";
import type { PromptRequest, RuntimeUserQuestionRequest, RuntimeUserQuestionResult } from "@vetta/runtime-core";
import {
	DesktopConversationError,
	type DesktopConversationService,
	type DesktopConversationSession,
	type DesktopConversationTurnResult,
} from "../../conversations/desktop-conversation-service.js";
import { getDesktopUserQuestionBroker } from "../../conversations/user-question-broker.js";
import { DebugError, type JsonValue } from "../types.js";

const TERMINAL_OPERATION_RETENTION_MS = 30 * 60 * 1_000;

type OperationStatus = "running" | "input_required" | "completed" | "failed" | "aborted";

interface PendingQuestion {
	request: RuntimeUserQuestionRequest;
	finish: (result: RuntimeUserQuestionResult) => void;
}

interface ConversationOperation {
	id: string;
	session: DesktopConversationSession;
	status: OperationStatus;
	abortController: AbortController;
	pendingQuestion?: PendingQuestion;
	result?: DesktopConversationTurnResult;
	error?: unknown;
	abortRequested: boolean;
	updatedAt: number;
	listeners: Set<() => void>;
	unregisterQuestionHandler: () => void;
	settled: Promise<void>;
}

export interface ConversationAnswerInput {
	operationId: string;
	interactionId: string;
	cancelled?: boolean;
	answers?: Array<{ question: string; answers: string[] }>;
}

function isTerminal(status: OperationStatus): boolean {
	return status === "completed" || status === "failed" || status === "aborted";
}

function toOperationResult(operation: ConversationOperation): JsonValue {
	if (operation.status === "input_required" && operation.pendingQuestion) {
		return {
			status: "input_required",
			operationId: operation.id,
			sessionId: operation.session.sessionId,
			sessionPath: operation.session.sessionPath,
			cwd: operation.session.cwd,
			interaction: {
				id: operation.pendingQuestion.request.requestId,
				type: "ask_user_question",
				questions: operation.pendingQuestion.request.questions as unknown as JsonValue,
			},
		};
	}
	if (operation.status === "completed" && operation.result) {
		return { operationId: operation.id, ...operation.result } as unknown as JsonValue;
	}
	if (operation.status === "aborted") {
		return {
			status: "aborted",
			operationId: operation.id,
			sessionId: operation.session.sessionId,
			sessionPath: operation.session.sessionPath,
			cwd: operation.session.cwd,
		};
	}
	if (operation.status === "failed") throw operation.error;
	throw new Error(`Operation ${operation.id} has no reportable state.`);
}

export class DebugConversationOperationCoordinator {
	private readonly operations = new Map<string, ConversationOperation>();
	private readonly operationIdsBySession = new Map<string, string>();

	constructor(private readonly service: DesktopConversationService) {}

	async start(
		session: DesktopConversationSession,
		prompt: PromptRequest,
		timeoutMs: number,
		requestSignal?: AbortSignal,
	): Promise<JsonValue> {
		this.pruneTerminalOperations();
		if (this.operationIdsBySession.has(session.sessionId)) {
			throw new DesktopConversationError("SESSION_BUSY", "Session already has an active debug operation.", {
				sessionPath: session.sessionPath,
			});
		}

		const operation = this.createOperation(session);
		operation.settled = this.service
			.runTurn({ session, prompt, timeoutMs, signal: operation.abortController.signal })
			.then((result) => {
				operation.result = result;
				this.transition(operation, "completed");
			})
			.catch((error: unknown) => {
				operation.error = error;
				this.transition(operation, operation.abortRequested ? "aborted" : "failed");
			});

		try {
			return await this.waitForReportableState(operation, requestSignal);
		} catch (error) {
			if (requestSignal?.aborted && !isTerminal(operation.status)) {
				operation.abortRequested = true;
				operation.abortController.abort();
				throw new DesktopConversationError("TURN_ABORTED", "Conversation turn was aborted by the caller.");
			}
			throw error;
		}
	}

	async answer(input: ConversationAnswerInput, signal?: AbortSignal): Promise<JsonValue> {
		this.pruneTerminalOperations();
		const operation = this.getOperation(input.operationId);
		const pending = operation.pendingQuestion;
		if (operation.status !== "input_required" || !pending) {
			throw new DebugError("DEBUG_INTERACTION_NOT_PENDING", "The conversation has no pending question.", {
				operationId: operation.id,
			});
		}
		if (pending.request.requestId !== input.interactionId) {
			throw new DebugError("DEBUG_INTERACTION_NOT_FOUND", "The pending interaction id does not match.", {
				operationId: operation.id,
				interactionId: input.interactionId,
			});
		}

		const result = this.validateAnswer(pending.request, input);
		pending.finish(result);
		return await this.waitForReportableState(operation, signal);
	}

	async wait(operationId: string, signal?: AbortSignal): Promise<JsonValue> {
		this.pruneTerminalOperations();
		return await this.waitForReportableState(this.getOperation(operationId), signal);
	}

	async abort(operationId: string): Promise<JsonValue> {
		this.pruneTerminalOperations();
		const operation = this.getOperation(operationId);
		if (!isTerminal(operation.status)) {
			operation.abortRequested = true;
			operation.abortController.abort();
			await operation.settled;
		}
		return toOperationResult(operation);
	}

	private createOperation(session: DesktopConversationSession): ConversationOperation {
		const operation: ConversationOperation = {
			id: randomUUID(),
			session,
			status: "running",
			abortController: new AbortController(),
			abortRequested: false,
			updatedAt: Date.now(),
			listeners: new Set(),
			unregisterQuestionHandler: () => undefined,
			settled: Promise.resolve(),
		};
		operation.unregisterQuestionHandler = getDesktopUserQuestionBroker().registerDebugHandler(
			session.sessionId,
			(request, signal) => this.handleQuestion(operation, request, signal),
		);
		this.operations.set(operation.id, operation);
		this.operationIdsBySession.set(session.sessionId, operation.id);
		return operation;
	}

	private handleQuestion(
		operation: ConversationOperation,
		request: RuntimeUserQuestionRequest,
		signal?: AbortSignal,
	): Promise<RuntimeUserQuestionResult> {
		if (signal?.aborted || isTerminal(operation.status)) {
			return Promise.resolve({ cancelled: true, answers: [] });
		}
		return new Promise<RuntimeUserQuestionResult>((resolve) => {
			let finished = false;
			const finish = (result: RuntimeUserQuestionResult): void => {
				if (finished) return;
				finished = true;
				if (signal) signal.removeEventListener("abort", onAbort);
				if (operation.pendingQuestion?.request.requestId === request.requestId) {
					operation.pendingQuestion = undefined;
					if (!isTerminal(operation.status)) this.transition(operation, "running");
				}
				resolve(result);
			};
			const onAbort = (): void => finish({ cancelled: true, answers: [] });
			if (signal) signal.addEventListener("abort", onAbort, { once: true });
			operation.pendingQuestion = { request, finish };
			this.transition(operation, "input_required");
		});
	}

	private validateAnswer(
		request: RuntimeUserQuestionRequest,
		input: ConversationAnswerInput,
	): RuntimeUserQuestionResult {
		if (input.cancelled === true) return { cancelled: true, answers: [] };
		const answers = input.answers ?? [];
		const expectedQuestions = new Set(request.questions.map((question) => question.question));
		const answeredQuestions = new Set<string>();
		for (const answer of answers) {
			if (!expectedQuestions.has(answer.question) || answeredQuestions.has(answer.question)) {
				throw new DebugError("DEBUG_INVALID_INPUT", "Answers must match each pending question exactly once.");
			}
			if (answer.answers.length === 0 || answer.answers.some((value) => value.trim().length === 0)) {
				throw new DebugError("DEBUG_INVALID_INPUT", "Each pending question requires a non-empty answer.");
			}
			answeredQuestions.add(answer.question);
		}
		if (answeredQuestions.size !== expectedQuestions.size) {
			throw new DebugError("DEBUG_INVALID_INPUT", "Every pending question must be answered.");
		}
		return { cancelled: false, answers };
	}

	private async waitForReportableState(operation: ConversationOperation, signal?: AbortSignal): Promise<JsonValue> {
		while (operation.status === "running") {
			await new Promise<void>((resolve, reject) => {
				const finish = (): void => {
					operation.listeners.delete(onChange);
					if (signal) signal.removeEventListener("abort", onAbort);
				};
				const onChange = (): void => {
					finish();
					resolve();
				};
				const onAbort = (): void => {
					finish();
					reject(new DebugError("DEBUG_WAIT_ABORTED", "Waiting for the conversation operation was aborted."));
				};
				if (signal?.aborted) {
					onAbort();
					return;
				}
				operation.listeners.add(onChange);
			});
		}
		return toOperationResult(operation);
	}

	private transition(operation: ConversationOperation, status: OperationStatus): void {
		operation.status = status;
		operation.updatedAt = Date.now();
		if (isTerminal(status)) {
			operation.unregisterQuestionHandler();
			this.operationIdsBySession.delete(operation.session.sessionId);
		}
		for (const listener of operation.listeners) listener();
	}

	private getOperation(operationId: string): ConversationOperation {
		const operation = this.operations.get(operationId);
		if (!operation) {
			throw new DebugError("DEBUG_OPERATION_NOT_FOUND", "Conversation operation was not found.", { operationId });
		}
		return operation;
	}

	private pruneTerminalOperations(): void {
		const expiresBefore = Date.now() - TERMINAL_OPERATION_RETENTION_MS;
		for (const [operationId, operation] of this.operations) {
			if (isTerminal(operation.status) && operation.updatedAt < expiresBefore) {
				this.operations.delete(operationId);
			}
		}
	}
}
