import {
	AIStreamProtocolError,
	type AssistantMessage,
	type AssistantMessageEvent,
	getAssistantMessageEventResult,
	isAssistantMessageTerminalEvent,
} from "../protocol/index.js";

interface EventStreamWaiter<T> {
	resolve(value: IteratorResult<T>): void;
	reject(error: unknown): void;
}

export class EventStreamEndedWithoutResultError extends AIStreamProtocolError {
	constructor() {
		super("Event stream ended without a terminal result", {
			metadata: { reason: "ended_without_result" },
		});
		this.name = "EventStreamEndedWithoutResultError";
	}
}

// Generic event stream class for async iteration
export class EventStream<T, R = T> implements AsyncIterable<T> {
	private queue: T[] = [];
	private waiting: EventStreamWaiter<T>[] = [];
	private done = false;
	private failed = false;
	private failure: unknown;
	private finalResultPromise: Promise<R>;
	private resolveFinalResult!: (result: R) => void;
	private rejectFinalResult!: (error: unknown) => void;

	constructor(
		private isComplete: (event: T) => boolean,
		private extractResult: (event: T) => R,
	) {
		this.finalResultPromise = new Promise((resolve, reject) => {
			this.resolveFinalResult = resolve;
			this.rejectFinalResult = reject;
		});
		void this.finalResultPromise.catch(() => undefined);
	}

	push(event: T): void {
		if (this.done) return;

		let complete: boolean;
		try {
			complete = this.isComplete(event);
		} catch (error) {
			this.fail(error);
			return;
		}

		if (complete) {
			let result: R;
			try {
				result = this.extractResult(event);
			} catch (error) {
				this.fail(error);
				return;
			}
			this.done = true;
			this.resolveFinalResult(result);
		}

		// Deliver to waiting consumer or queue it
		const waiter = this.waiting.shift();
		if (waiter) {
			waiter.resolve({ value: event, done: false });
		} else {
			this.queue.push(event);
		}

		if (complete) this.notifyDone();
	}

	end(...args: [] | [result: R]): void {
		if (this.done) return;
		if (args.length === 0) {
			this.fail(new EventStreamEndedWithoutResultError());
			return;
		}

		this.done = true;
		this.resolveFinalResult(args[0]);
		this.notifyDone();
	}

	fail(error: unknown): void {
		if (this.done) return;
		this.done = true;
		this.failed = true;
		this.failure = error;
		this.rejectFinalResult(error);
		while (this.waiting.length > 0) {
			this.waiting.shift()!.reject(error);
		}
	}

	private notifyDone(): void {
		while (this.waiting.length > 0) {
			const waiter = this.waiting.shift()!;
			waiter.resolve({ value: undefined, done: true });
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		while (true) {
			if (this.queue.length > 0) {
				yield this.queue.shift()!;
			} else if (this.failed) {
				throw this.failure;
			} else if (this.done) {
				return;
			} else {
				const result = await new Promise<IteratorResult<T>>((resolve, reject) =>
					this.waiting.push({ resolve, reject }),
				);
				if (result.done) return;
				yield result.value;
			}
		}
	}

	result(): Promise<R> {
		return this.finalResultPromise;
	}
}

export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(isAssistantMessageTerminalEvent, getAssistantMessageEventResult);
	}
}

/** Factory function for AssistantMessageEventStream (for use in extensions) */
export function createAssistantMessageEventStream(): AssistantMessageEventStream {
	return new AssistantMessageEventStream();
}
