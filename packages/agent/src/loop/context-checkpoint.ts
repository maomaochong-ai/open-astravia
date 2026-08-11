import type { AssistantMessage, EventStream } from "@vetta/ai";
import type { AgentContextCheckpointReason, AgentContextCheckpointResult, AgentEvent, AgentMessage } from "../types.js";

export class AgentContextCheckpointFailure extends Error {
	constructor(cause: unknown) {
		super("Agent context checkpoint failed", { cause });
		this.name = "AgentContextCheckpointFailure";
	}
}

export class AgentContextCheckpointTimeoutError extends Error {
	readonly code = "AGENT_CONTEXT_CHECKPOINT_TIMEOUT";

	constructor(readonly timeoutMs: number) {
		super(`Agent context checkpoint was not completed within ${timeoutMs}ms`);
		this.name = "AgentContextCheckpointTimeoutError";
	}
}

export interface AgentContextCheckpointOptions {
	readonly signal?: AbortSignal;
	readonly timeoutMs: number;
}

export function requestContextCheckpoint(
	reason: AgentContextCheckpointReason,
	messages: readonly AgentMessage[],
	recoveryAttempt: number,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	options: AgentContextCheckpointOptions,
	assistantMessage?: AssistantMessage,
): Promise<AgentContextCheckpointResult | undefined> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const onAbort = () => fail(abortError(options.signal?.reason));
		const cleanup = () => {
			if (timeout) clearTimeout(timeout);
			options.signal?.removeEventListener("abort", onAbort);
		};
		const complete = (result?: AgentContextCheckpointResult) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(result);
		};
		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(new AgentContextCheckpointFailure(error));
		};

		if (options.signal?.aborted) {
			fail(abortError(options.signal.reason));
			return;
		}
		options.signal?.addEventListener("abort", onAbort, { once: true });
		timeout = setTimeout(() => fail(new AgentContextCheckpointTimeoutError(options.timeoutMs)), options.timeoutMs);

		stream.push({
			type: "context_checkpoint",
			request: {
				reason,
				messages: [...messages],
				assistantMessage,
				recoveryAttempt,
				complete,
				fail,
			},
		});
	});
}

function abortError(reason: unknown): Error {
	const error = new Error("Agent context checkpoint aborted", { cause: reason });
	error.name = "AbortError";
	return error;
}
