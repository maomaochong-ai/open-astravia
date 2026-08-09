import { AI_ERROR_CODES, AIAbortedError, AIError, type AssistantMessageEvent } from "../protocol/index.js";
import type { Api, Context, Model, StreamOptions } from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";

export type ScriptedLanguageModelOutcome =
	| { readonly events: readonly AssistantMessageEvent[] }
	| { readonly error: unknown };

export interface ScriptedLanguageModelCall {
	readonly model: Model<Api>;
	readonly context: Context;
	readonly options?: StreamOptions;
}

export class ScriptedLanguageModel {
	readonly calls: ScriptedLanguageModelCall[] = [];
	readonly #outcomes: ScriptedLanguageModelOutcome[];

	constructor(outcomes: readonly ScriptedLanguageModelOutcome[]) {
		this.#outcomes = [...outcomes];
	}

	get remaining(): number {
		return this.#outcomes.length;
	}

	stream(model: Model<Api>, context: Context, options?: StreamOptions): AssistantMessageEventStream {
		const stream = new AssistantMessageEventStream();
		if (options?.signal?.aborted) {
			queueMicrotask(() => stream.fail(new AIAbortedError()));
			return stream;
		}

		const callIndex = this.calls.length;
		this.calls.push({ model, context, options });
		const outcome = this.#outcomes.shift();
		const onAbort = () => stream.fail(new AIAbortedError());
		options?.signal?.addEventListener("abort", onAbort, { once: true });

		queueMicrotask(() => {
			try {
				if (options?.signal?.aborted) {
					stream.fail(new AIAbortedError());
					return;
				}
				if (!outcome) {
					stream.fail(
						new AIError(AI_ERROR_CODES.INVALID_REQUEST, "No scripted model outcome remains", {
							metadata: { callIndex },
						}),
					);
					return;
				}
				if ("error" in outcome) {
					stream.fail(outcome.error);
					return;
				}
				for (const event of outcome.events) stream.push(event);
				if (!outcome.events.some((event) => event.type === "done" || event.type === "error")) stream.end();
			} finally {
				options?.signal?.removeEventListener("abort", onAbort);
			}
		});

		return stream;
	}
}
