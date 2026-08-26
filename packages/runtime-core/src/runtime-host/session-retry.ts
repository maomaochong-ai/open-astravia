import type { RuntimeTurnPromptOutcome, SessionEvent } from "../contracts.js";
import { type RuntimeFailure, readRuntimeFailure } from "../failure-contract.js";
import type { RuntimeObservationPublisher } from "../observation/index.js";
import {
	RuntimeTurnRetryCoordinator,
	type RuntimeTurnRetryEvent,
	type RuntimeTurnRetryPolicy,
} from "../retry/index.js";
import type { RuntimeSession } from "./kernel-runtime-session-backend.js";
import type { RuntimeHostSessionAssembly } from "./session-backend.js";
import { mapRuntimeSessionObservationEvent } from "./session-events.js";
import type { RuntimeSessionEventStream, RuntimeTurnPrompt } from "./session-ports.js";

export interface RuntimeHostSessionRetryOptions {
	readonly policy: RuntimeTurnRetryPolicy;
	readonly readFailure: (result: unknown) => RuntimeFailure | undefined;
	readonly observationPublisher?: RuntimeObservationPublisher;
}

type RuntimeErrorEvent = Extract<SessionEvent, { readonly type: "error" }>;
type RuntimeAgentEndEvent = Extract<SessionEvent, { readonly type: "session.lifecycle" }>;

/**
 * Adds product-neutral retry coordination to a standard Runtime Session assembly.
 * Product code supplies only failure projection and policy; Runtime owns operation
 * state, cancellation and host event ordering.
 */
export function withRuntimeHostSessionRetry(
	session: RuntimeSession,
	assembly: RuntimeHostSessionAssembly,
	options: RuntimeHostSessionRetryOptions,
): RuntimeHostSessionAssembly {
	const sessionId = assembly.lifecycle.sessionId;
	const events = new DeferredRuntimeRetryEventStream(sessionId, assembly.corePorts.eventStream);
	const retry = new RuntimeTurnRetryCoordinator({
		policy: options.policy,
		emit: (event) => events.emitRetry(event),
		observationPublisher: options.observationPublisher,
		observationContext: { sessionId },
	});
	const run = async (execute: () => Promise<unknown>): Promise<unknown> => {
		try {
			const result = await retry.run(execute, () => session.retry(), options.readFailure);
			if (isPromptReceipt(result)) return result;
			if (options.readFailure(result)) events.flushPendingError();
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

/** Holds failed-attempt terminal events until the retry operation settles. */
export class DeferredRuntimeRetryEventStream implements RuntimeSessionEventStream {
	private readonly listeners = new Set<(event: SessionEvent) => void>();
	private readonly unsubscribe: () => void;
	private pendingError: RuntimeErrorEvent | undefined;
	private pendingAgentEnd: RuntimeAgentEndEvent | undefined;
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

	emitRetry(event: RuntimeTurnRetryEvent): void {
		if (event.type === "auto_retry_start") {
			this.retryAttempts = event.attempt;
			this.pendingAgentEnd = undefined;
			this.broadcast(
				mapRuntimeSessionObservationEvent(this.sessionId, {
					type: "retry.start",
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					delayMs: event.delayMs,
					errorMessage: event.errorMessage,
					...(event.failure ? { failure: event.failure } : {}),
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
				...(event.failure ? { failure: event.failure } : {}),
				source: "agent",
			}),
		);
	}

	clearPendingError(): void {
		this.pendingError = undefined;
		this.pendingAgentEnd = undefined;
		this.retryAttempts = 0;
	}

	flushPendingError(): boolean {
		const pending = this.pendingError;
		if (!pending) return false;
		const pendingAgentEnd = this.pendingAgentEnd;
		const retryAttempts = this.retryAttempts;
		this.clearPendingError();
		this.broadcast({ ...pending, retryAttempts });
		if (pendingAgentEnd) this.broadcast(pendingAgentEnd);
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
		if (event.type === "session.lifecycle" && event.phase === "agent_end" && this.pendingError) {
			this.pendingAgentEnd = event;
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
		if (status === "completed" || status === "cancelled" || status === "failed") {
			const candidate = result as { error?: unknown; turnId?: unknown };
			const error = readRuntimeFailure(candidate.error);
			return {
				status,
				...(error ? { error } : {}),
				...(typeof candidate.turnId === "string" ? { turnId: candidate.turnId } : {}),
			};
		}
	}
	return { status: "completed" };
}
