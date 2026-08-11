import type {
	RuntimeHostSessionAssembly,
	RuntimeSession,
	RuntimeSessionEventStream,
	RuntimeTurnPrompt,
	RuntimeTurnPromptOutcome,
	SessionEvent,
} from "@vetta/runtime-core";
import { mapRuntimeSessionObservationEvent } from "@vetta/runtime-core";
import type { CodingAgentTurnRetryEvent, CodingAgentTurnRetrySettings } from "../session-execution/contracts.js";
import { readCodingAgentFailedTurnMessage } from "../session-execution/turn-executor.js";
import { createCodingAgentTurnRetryController } from "../session-execution/turn-retry-controller.js";

export interface CodingAgentRuntimeHostRetrySettings {
	getRetrySettings(): CodingAgentTurnRetrySettings;
	setRetryEnabled(enabled: boolean): void;
}

type RuntimeErrorEvent = Extract<SessionEvent, { readonly type: "error" }>;

/** 排队 / 拦截回执：prompt 未开启 turn 时的即时返回值（ADR-0060）。 */
function isPromptReceipt(result: unknown): result is { status: "queued" | "handled" } {
	return (
		typeof result === "object" &&
		result !== null &&
		"status" in result &&
		((result as { status: unknown }).status === "queued" || (result as { status: unknown }).status === "handled")
	);
}

function mapPromptOutcome(result: unknown): RuntimeTurnPromptOutcome {
	if (typeof result === "object" && result !== null && "status" in result) {
		const { status } = result as { status: unknown };
		if (status === "queued") {
			const receipt = result as { pendingCount?: unknown; id?: unknown };
			return {
				status: "queued",
				pendingCount: typeof receipt.pendingCount === "number" ? receipt.pendingCount : undefined,
				queueItemId: typeof receipt.id === "string" ? receipt.id : undefined,
			};
		}
		if (status === "handled") return { status: "handled" };
		if (status === "completed" || status === "cancelled" || status === "failed") return { status };
	}
	return { status: "completed" };
}

/**
 * 为 RuntimeHost 会话补齐 Coding Agent 自动重试，并延迟失败事件直到重试结束。
 * Runtime Core 只看到标准 SessionEvent，不依赖具体设置存储或错误判定规则。
 */
export function withCodingAgentRuntimeHostRetry(
	session: RuntimeSession,
	assembly: RuntimeHostSessionAssembly,
	settings: CodingAgentRuntimeHostRetrySettings,
): RuntimeHostSessionAssembly {
	const events = new DeferredRuntimeErrorEventStream(assembly.lifecycle.sessionId, assembly.corePorts.eventStream);
	const retry = createCodingAgentTurnRetryController({
		readSettings: () => settings.getRetrySettings(),
		setEnabled: (enabled) => settings.setRetryEnabled(enabled),
		emit: (event) => events.emitRetry(event),
	});
	const run = async (execute: () => Promise<unknown>): Promise<unknown> => {
		try {
			const result = await retry.run(execute, () => session.retry(), readCodingAgentFailedTurnMessage);
			// 排队/拦截回执（ADR-0060）不是 turn 结果：立即返回，不结算 pending error，
			// 避免误清仍在 streaming 的当前 turn 挂起的错误。
			if (isPromptReceipt(result)) return result;
			if (readCodingAgentFailedTurnMessage(result)) events.flushPendingError();
			else events.clearPendingError();
			return result;
		} catch (error) {
			if (!events.flushPendingError()) throw error;
			return undefined;
		}
	};
	const lifecycle = assembly.lifecycle;

	return {
		...assembly,
		lifecycle: {
			...lifecycle,
			dispose: async () => {
				retry.abortRetry();
				events.dispose();
				await lifecycle.dispose();
			},
		},
		corePorts: {
			...assembly.corePorts,
			turnControl: {
				prompt: async (request: RuntimeTurnPrompt) => mapPromptOutcome(await run(() => session.prompt(request))),
				continue: async () => {
					await run(() => session.continue());
				},
				abort: async () => {
					retry.abortRetry();
					await session.abort();
				},
			},
			eventStream: events,
		},
	};
}

class DeferredRuntimeErrorEventStream implements RuntimeSessionEventStream {
	private readonly listeners = new Set<(event: SessionEvent) => void>();
	private readonly unsubscribe: () => void;
	private pendingError: RuntimeErrorEvent | undefined;
	private retryAttempts = 0;

	constructor(
		private readonly sessionId: string,
		source: RuntimeSessionEventStream,
	) {
		this.unsubscribe = source.subscribe((event) => this.accept(event));
	}

	subscribe(handler: (event: SessionEvent) => void): () => void {
		this.listeners.add(handler);
		return () => this.listeners.delete(handler);
	}

	emitRetry(event: CodingAgentTurnRetryEvent): void {
		if (event.type === "auto_retry_start") {
			this.retryAttempts = event.attempt;
			this.broadcast(
				mapRuntimeSessionObservationEvent(this.sessionId, {
					type: "retry.start",
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					delayMs: event.delayMs,
					errorMessage: event.errorMessage,
					source: "agent",
				}),
			);
			return;
		}
		if (event.success) this.clearPendingError();
		this.broadcast(
			mapRuntimeSessionObservationEvent(this.sessionId, {
				type: "retry.end",
				success: event.success,
				attempt: event.attempt,
				finalError: event.finalError,
				source: "agent",
			}),
		);
	}

	clearPendingError(): void {
		this.pendingError = undefined;
		this.retryAttempts = 0;
	}

	flushPendingError(): boolean {
		const pending = this.pendingError;
		if (!pending) return false;
		this.broadcast({ ...pending, retryAttempts: this.retryAttempts });
		this.clearPendingError();
		return true;
	}

	dispose(): void {
		this.unsubscribe();
		this.listeners.clear();
		this.clearPendingError();
	}

	private accept(event: SessionEvent): void {
		if (event.type === "error") {
			this.pendingError = event;
			return;
		}
		if (event.type === "message.final" && event.message.role === "assistant") {
			if (event.message.stopReason !== "error") this.clearPendingError();
		}
		if (event.type === "session.lifecycle" && event.phase === "aborted") {
			this.clearPendingError();
		}
		this.broadcast(event);
	}

	private broadcast(event: SessionEvent): void {
		for (const listener of this.listeners) listener(event);
	}
}
