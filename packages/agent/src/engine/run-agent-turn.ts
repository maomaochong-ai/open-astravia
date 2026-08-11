import { type AssistantMessage, EventStream, type Message } from "@vetta/ai";
import { validateAgentRunLimits } from "./limits.js";
import { executeRuntimeToolCalls } from "./tool-executor.js";
import type {
	AgentCheckpointResult,
	AgentExecutionEvent,
	AgentPendingInputKind,
	AgentRun,
	AgentRunResult,
	AgentRunStatus,
	AgentTurnRequest,
	ResolvedModelCall,
} from "./types.js";

interface RunState {
	messages: Message[];
	modelCalls: number;
	toolCalls: number;
	recoveryAttempts: number;
	lastAssistantMessage?: AgentRunResult["lastAssistantMessage"];
}

interface PendingInput {
	readonly kind: AgentPendingInputKind;
	readonly messages: readonly Message[];
}

export function runAgentTurn(request: AgentTurnRequest): AgentRun {
	validateAgentRunLimits(request.limits);
	const stream = new EventStream<AgentExecutionEvent, AgentRunResult>(
		(event) => event.type === "run_finish",
		(event) => {
			if (event.type === "run_finish") return event.result;
			throw new Error("Expected run_finish event");
		},
	);
	const runSignal = createRunSignal(request.signal, request.limits.deadlineMs);
	void executeRun(request, runSignal.signal, stream).finally(runSignal.dispose);
	return { events: stream, result: stream.result() };
}

async function executeRun(
	request: AgentTurnRequest,
	signal: AbortSignal,
	stream: EventStream<AgentExecutionEvent, AgentRunResult>,
): Promise<void> {
	const state: RunState = {
		messages: [...request.messages],
		modelCalls: 0,
		toolCalls: 0,
		recoveryAttempts: 0,
	};
	const emit = createEmitter(stream, request.observer);
	emit({ type: "run_start" });

	try {
		let pendingInput = await takeInput(request, "steering", state, signal);
		while (true) {
			signal.throwIfAborted();
			if (pendingInput) {
				appendInput(state, pendingInput, emit);
				pendingInput = undefined;
			}
			if (state.modelCalls >= request.limits.maxModelCalls) {
				finish("max_model_calls", state, emit);
				return;
			}

			const modelCallIndex = state.modelCalls;
			const tools = await interruptible(
				request.resolveTools({ modelCallIndex, messages: [...state.messages], signal }),
				signal,
			);
			const prepared = await checkpoint(request, "model_call", state, modelCallIndex, signal);
			if (prepared?.contextMessages) state.messages = [...prepared.contextMessages];
			const modelMessages = prepared?.messages ?? state.messages;

			state.modelCalls += 1;
			let resolved: ResolvedModelCall | undefined;
			try {
				const resolving = request
					.resolveModelCall({
						modelCallIndex,
						messages: [...modelMessages],
						tools,
						signal,
					})
					.then((modelCall) => {
						void modelCall.response.result.catch(() => undefined);
						return modelCall;
					});
				resolved = await interruptible(resolving, signal);
				emit({
					type: "model_call_start",
					modelCallIndex,
					callId: resolved.callId,
					snapshotId: resolved.snapshotId,
				});
				const assistant = await consumeModelResponse(resolved, modelCallIndex, emit, signal);
				state.lastAssistantMessage = assistant;
				state.messages.push(assistant);
				emit({ type: "model_call_finish", modelCallIndex, callId: resolved.callId, status: "completed" });
				emit({ type: "assistant_message", message: assistant });
			} catch (error) {
				emit({ type: "model_call_finish", modelCallIndex, callId: resolved?.callId, status: "failed" });
				if (signal.aborted) throw error;
				const recovery = await checkpoint(request, "assistant_error", state, modelCallIndex, signal);
				if (recovery?.retry) {
					if (state.recoveryAttempts >= request.limits.maxRecoveryAttempts) {
						finish("recovery_exhausted", state, emit, error);
						return;
					}
					state.messages = [...(recovery.contextMessages ?? recovery.messages ?? state.messages)];
					state.recoveryAttempts += 1;
					pendingInput = await takeInput(request, "steering", state, signal);
					continue;
				}
				finish("failed", state, emit, error);
				return;
			}

			// 中断挽救路径：部分 assistant 消息已入 state.messages 并发出
			// assistant_message 事件（宿主据此落盘），这里走统一 aborted 终止。
			if (signal.aborted) throw abortError(signal.reason);

			const toolCalls = state.lastAssistantMessage?.content.filter((block) => block.type === "toolCall") ?? [];
			if (toolCalls.length === 0) {
				const completed = await checkpoint(
					request,
					"assistant_result",
					state,
					modelCallIndex,
					signal,
					state.lastAssistantMessage,
				);
				if (completed?.contextMessages) state.messages = [...completed.contextMessages];
				if (completed?.retry) {
					if (state.recoveryAttempts >= request.limits.maxRecoveryAttempts) {
						finish("recovery_exhausted", state, emit);
						return;
					}
					state.messages = [...(completed.contextMessages ?? completed.messages ?? state.messages)];
					state.recoveryAttempts += 1;
					pendingInput = await takeInput(request, "steering", state, signal);
					continue;
				}

				pendingInput =
					(await takeInput(request, "steering", state, signal)) ??
					(await takeInput(request, "continuation", state, signal));
				if (pendingInput) continue;
				finish("completed", state, emit);
				return;
			}
			if (state.toolCalls + toolCalls.length > request.limits.maxToolCalls) {
				finish("max_tool_calls", state, emit);
				return;
			}
			state.toolCalls += toolCalls.length;
			const batch = await interruptible(
				executeRuntimeToolCalls({
					calls: toolCalls,
					tools,
					messages: [...state.messages],
					modelCallIndex,
					signal,
					policy: request.toolPolicy,
					emit,
					takeSteeringMessages: request.takeSteeringMessages,
				}),
				signal,
			);
			state.messages.push(...batch.results);
			if (batch.steeringMessages && batch.steeringMessages.length > 0) {
				pendingInput = { kind: "steering", messages: batch.steeringMessages };
			}
		}
	} catch (error) {
		finish(signal.aborted ? "aborted" : "failed", state, emit, error);
	}
}

async function takeInput(
	request: AgentTurnRequest,
	kind: AgentPendingInputKind,
	state: RunState,
	signal: AbortSignal,
): Promise<PendingInput | undefined> {
	const collector = kind === "steering" ? request.takeSteeringMessages : request.takeContinuationMessages;
	if (!collector) return undefined;
	const messages = await interruptible(
		collector({ modelCallIndex: state.modelCalls, messages: [...state.messages], signal }),
		signal,
	);
	return messages.length === 0 ? undefined : { kind, messages };
}

function appendInput(state: RunState, input: PendingInput, emit: (event: AgentExecutionEvent) => void): void {
	for (const message of input.messages) {
		state.messages.push(message);
		emit({ type: "input_message", kind: input.kind, message });
	}
}

/**
 * 中断后等待 provider 交回带 `stopReason: "aborted"` 部分消息的宽限时长。
 * provider 在同一 signal 上中止底层请求并立即收尾组装，正常在毫秒级完成；
 * 上限只防 provider 实现不收尾时无限等待。
 */
const ABORT_SALVAGE_TIMEOUT_MS = 1500;

async function consumeModelResponse(
	resolved: ResolvedModelCall,
	modelCallIndex: number,
	emit: (event: AgentExecutionEvent) => void,
	signal: AbortSignal,
) {
	const settledResult = resolved.response.result.then(
		(value) => ({ status: "fulfilled" as const, value }),
		(reason: unknown) => ({ status: "rejected" as const, reason }),
	);
	// 事件流里的 partial 是 provider 持续累积的 assistant 消息快照；abort 挽救的
	// 事实源。provider 在 abort 时 fail() 掉 result（如 anthropic adapter），
	// 已流出的内容只存在于这里。
	let lastPartial: AssistantMessage | undefined;
	try {
		await interruptible(
			(async () => {
				for await (const event of resolved.response.events) {
					if ("partial" in event && event.partial) lastPartial = event.partial;
					emit({ type: "model_event", modelCallIndex, event });
				}
			})(),
			signal,
		);
		const settled = await interruptible(settledResult, signal);
		if (settled.status === "rejected") throw settled.reason;
		return settled.value;
	} catch (error) {
		if (!signal.aborted) throw error;
		// 中断挽救：立刻放弃会让已流出的内容既不进 state.messages 也不落盘
		// （UI 上先显示、随后被历史重放吞掉）。优先等 result 短宽限内交回完整的
		// aborted 消息；provider 直接 reject 时退回事件流累积的 partial。
		const salvaged = await Promise.race([
			settledResult,
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ABORT_SALVAGE_TIMEOUT_MS)),
		]);
		if (salvaged?.status === "fulfilled") return salvaged.value;
		if (lastPartial && lastPartial.content.length > 0) {
			return { ...lastPartial, stopReason: "aborted" as const };
		}
		throw error;
	}
}

async function checkpoint(
	request: AgentTurnRequest,
	reason: "model_call" | "assistant_result" | "assistant_error",
	state: RunState,
	modelCallIndex: number,
	signal: AbortSignal,
	assistantMessage?: AgentRunResult["lastAssistantMessage"],
): Promise<AgentCheckpointResult | undefined> {
	if (!request.checkpoint) return undefined;
	return await withTimeout(
		request.checkpoint(
			{
				reason,
				messages: [...state.messages],
				modelCallIndex,
				recoveryAttempt: state.recoveryAttempts,
				assistantMessage,
			},
			signal,
		),
		request.limits.checkpointTimeoutMs,
		signal,
	);
}

function finish(
	status: AgentRunStatus,
	state: RunState,
	emit: (event: AgentExecutionEvent) => void,
	error?: unknown,
): void {
	const result: AgentRunResult = {
		status,
		messages: [...state.messages],
		modelCalls: state.modelCalls,
		toolCalls: state.toolCalls,
		recoveryAttempts: state.recoveryAttempts,
		lastAssistantMessage: state.lastAssistantMessage,
		failure: error === undefined ? undefined : failureOf(error),
	};
	emit({ type: "run_finish", result });
}

function createEmitter(
	stream: EventStream<AgentExecutionEvent, AgentRunResult>,
	observer?: (event: AgentExecutionEvent) => void,
): (event: AgentExecutionEvent) => void {
	return (event) => {
		stream.push(event);
		if (!observer) return;
		try {
			observer(event);
		} catch (error) {
			stream.push({
				type: "diagnostic",
				source: "observer",
				message: error instanceof Error ? error.message : "Agent observer failed",
			});
		}
	};
}

function createRunSignal(
	parent: AbortSignal,
	deadlineMs?: number,
): {
	readonly signal: AbortSignal;
	readonly dispose: () => void;
} {
	if (deadlineMs === undefined) {
		return { signal: parent, dispose: () => undefined };
	}
	const controller = new AbortController();
	const onAbort = () => controller.abort(parent.reason);
	if (parent.aborted) onAbort();
	else parent.addEventListener("abort", onAbort, { once: true });
	const timer = setTimeout(() => controller.abort("deadline exceeded"), deadlineMs);
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timer);
			parent.removeEventListener("abort", onAbort);
		},
	};
}

function interruptible<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(abortError(signal.reason));
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(abortError(signal.reason));
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
	});
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`Agent checkpoint exceeded ${timeoutMs}ms`)), timeoutMs);
	});
	return interruptible(Promise.race([promise, timeout]), signal).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

function abortError(reason: unknown): Error {
	const error = new Error("Agent run aborted", { cause: reason });
	error.name = "AbortError";
	return error;
}

function failureOf(error: unknown): { code: string; message: string } {
	if (error instanceof Error) {
		const code = "code" in error && typeof error.code === "string" ? error.code : error.name;
		return { code, message: error.message };
	}
	return { code: "AGENT_RUN_FAILED", message: String(error) };
}
