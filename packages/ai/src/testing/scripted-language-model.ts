import {
	AI_ERROR_CODES,
	AIAbortedError,
	AIError,
	type Api,
	type AssistantMessageEvent,
	type Context,
} from "../protocol/index.js";
import {
	type LanguageModelAdapter,
	LanguageModelStream,
	type LanguageModelStreamEvent,
	type ModelCallRequest,
	type ModelStreamResponse,
} from "../runtime/language-model-adapter.js";
import type { Model, StreamOptions } from "../types.js";
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

export type ScriptedLanguageModelAdapterOutcome =
	| { readonly events: readonly LanguageModelStreamEvent[] }
	| { readonly error: unknown };

export interface ScriptedLanguageModelAdapterCall {
	readonly request: ModelCallRequest;
}

/**
 * Deterministic native Adapter test double. It mirrors Vercel's mock model shape:
 * every request is recorded and outcomes can be supplied in call order.
 */
export class ScriptedLanguageModelAdapter implements LanguageModelAdapter {
	readonly api: Api;
	readonly calls: ScriptedLanguageModelAdapterCall[] = [];
	readonly #outcomes: ScriptedLanguageModelAdapterOutcome[];

	constructor(api: Api, outcomes: readonly ScriptedLanguageModelAdapterOutcome[]) {
		this.api = api;
		this.#outcomes = [...outcomes];
	}

	get remaining(): number {
		return this.#outcomes.length;
	}

	async stream(request: ModelCallRequest): Promise<ModelStreamResponse> {
		this.calls.push({ request });
		const stream = new LanguageModelStream();
		const callIndex = this.calls.length - 1;
		const signal = request.options?.signal;
		if (signal?.aborted) {
			stream.fail(
				new AIAbortedError("Model call was aborted", {
					provider: request.model.provider,
					modelId: request.model.id,
				}),
			);
			return { events: stream, result: stream.result() };
		}
		const outcome = this.#outcomes.shift();

		const onAbort = () =>
			stream.fail(
				new AIAbortedError("Model call was aborted", {
					provider: request.model.provider,
					modelId: request.model.id,
				}),
			);
		signal?.addEventListener("abort", onAbort, { once: true });
		queueMicrotask(() => {
			try {
				if (signal?.aborted) return;
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
				if (!outcome.events.some((event) => event.type === "done")) stream.end();
			} finally {
				signal?.removeEventListener("abort", onAbort);
			}
		});
		return { events: stream, result: stream.result() };
	}
}
