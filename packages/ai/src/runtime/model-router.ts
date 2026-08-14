import {
	AI_ERROR_CODES,
	AIError,
	type AIErrorCode,
	type Api,
	type AssistantMessageEvent,
	createAIErrorFromDetails,
} from "../protocol/index.js";
import type { Model } from "../types.js";
import type { AdapterRegistry } from "./adapter-registry.js";
import { getDefaultAdapterRegistry } from "./default-adapter-registry.js";
import {
	failLanguageModelStream,
	LanguageModelStream,
	type ModelCallRequest,
	type ModelGenerateResponse,
	type ModelStreamResponse,
} from "./language-model-adapter.js";
import { normalizeLegacyProviderError } from "./legacy-error-classifier.js";
import { collectModelCallResult } from "./model-call-result.js";
import { resolveEffectiveModelCapabilities } from "./model-capabilities.js";

export interface ModelRouteCandidate {
	readonly model: Model<Api>;
	readonly reason?: string;
}

export interface ModelRoutePolicy {
	readonly fallbackCodes?: readonly AIErrorCode[];
	readonly maxCandidates?: number;
}

export interface ModelRouteResult {
	readonly model: Model<Api>;
	readonly response: ModelStreamResponse;
}

export class ModelRouter {
	readonly #registry: AdapterRegistry;

	constructor(registry: AdapterRegistry = getDefaultAdapterRegistry()) {
		this.#registry = registry;
	}

	resolve(
		candidates: readonly ModelRouteCandidate[],
		policy: ModelRoutePolicy = {},
		mode: "stream" | "generate" = "stream",
	): ModelRouteCandidate[] {
		const limit = policy.maxCandidates ?? candidates.length;
		return candidates
			.filter(({ model }) => this.#registry.get(model.api) !== undefined)
			.filter(({ model }) => {
				const adapter = this.#registry.get(model.api);
				return mode === "generate" || resolveEffectiveModelCapabilities(model, adapter?.capabilities).streaming;
			})
			.slice(0, limit);
	}

	async stream(
		request: ModelCallRequest,
		alternatives: readonly ModelRouteCandidate[] = [],
		policy: ModelRoutePolicy = {},
	): Promise<ModelRouteResult> {
		const candidates = this.resolve([{ model: request.model }, ...alternatives], policy, "stream");
		if (candidates.length === 0) throw this.noCandidate(request.model);

		let lastError: unknown;
		for (const candidate of candidates) {
			try {
				const source = await this.#registry.get(candidate.model.api)!.stream({
					...request,
					model: candidate.model,
				});
				const response = await prepareRoutedStream(candidate.model, source);
				return { model: candidate.model, response };
			} catch (error) {
				lastError = error;
				if (!isFallbackError(error, policy)) throw error;
			}
		}
		throw lastError ?? this.noCandidate(request.model);
	}

	async generate(
		request: ModelCallRequest,
		alternatives: readonly ModelRouteCandidate[] = [],
		policy: ModelRoutePolicy = {},
	): Promise<{ model: Model<Api>; response: ModelGenerateResponse }> {
		const candidates = this.resolve([{ model: request.model }, ...alternatives], policy, "generate");
		if (candidates.length === 0) throw this.noCandidate(request.model);

		let lastError: unknown;
		for (const candidate of candidates) {
			try {
				const adapter = this.#registry.get(candidate.model.api)!;
				if (adapter.generate) {
					const response = await adapter.generate({ ...request, model: candidate.model });
					await response.result;
					return { model: candidate.model, response };
				}
				const stream = await adapter.stream({ ...request, model: candidate.model });
				const response = { result: collectModelCallResult(stream) };
				await response.result;
				return { model: candidate.model, response };
			} catch (error) {
				lastError = error;
				if (!isFallbackError(error, policy)) throw error;
			}
		}
		throw lastError ?? this.noCandidate(request.model);
	}

	private noCandidate(model: Model<Api>): AIError {
		return new AIError(
			AI_ERROR_CODES.UNSUPPORTED_CAPABILITY,
			`No usable model route for ${model.provider}/${model.id}`,
			{
				provider: model.provider,
				modelId: model.id,
				metadata: { api: model.api },
			},
		);
	}
}

/**
 * Holds lifecycle-only events until a candidate either emits model output or
 * fails. This is the routing commit point: after output is visible, switching
 * providers would duplicate or splice one assistant response across models.
 */
async function prepareRoutedStream(model: Model<Api>, source: ModelStreamResponse): Promise<ModelStreamResponse> {
	const iterator = source.events[Symbol.asyncIterator]();
	const buffered: AssistantMessageEvent[] = [];
	observePromise(source.result);

	while (true) {
		let next: IteratorResult<AssistantMessageEvent>;
		try {
			next = await iterator.next();
		} catch (error) {
			await iterator.return?.();
			throw error;
		}
		if (next.done) {
			await iterator.return?.();
			throw new AIError(AI_ERROR_CODES.STREAM_PROTOCOL_FAILED, "Model stream ended without a terminal event", {
				provider: model.provider,
				modelId: model.id,
			});
		}

		const event = next.value;
		buffered.push(event);
		if (event.type === "error") {
			await iterator.return?.();
			throw event.failure
				? createAIErrorFromDetails(event.failure)
				: normalizeLegacyProviderError(new Error(event.error.errorMessage || "Model call failed"), model);
		}
		if (isRoutingCommitEvent(event)) return createCommittedResponse(model, source, iterator, buffered);
	}
}

function createCommittedResponse(
	model: Model<Api>,
	source: ModelStreamResponse,
	iterator: AsyncIterator<AssistantMessageEvent>,
	buffered: readonly AssistantMessageEvent[],
): ModelStreamResponse {
	const target = new LanguageModelStream();
	for (const event of buffered) target.push(event);
	void forwardCommittedEvents(model, iterator, target);
	return {
		events: target,
		result: target.result(),
		...(source.metadata ? { metadata: source.metadata } : {}),
	};
}

async function forwardCommittedEvents(
	model: Model<Api>,
	iterator: AsyncIterator<AssistantMessageEvent>,
	target: LanguageModelStream,
): Promise<void> {
	try {
		while (true) {
			const next = await iterator.next();
			if (next.done) break;
			target.push(next.value);
			if (next.value.type === "error") {
				target.fail(
					next.value.failure
						? createAIErrorFromDetails(next.value.failure)
						: normalizeLegacyProviderError(
								new Error(next.value.error.errorMessage || "Model call failed"),
								model,
							),
				);
				return;
			}
		}
		failLanguageModelStream(
			target,
			model,
			new AIError(AI_ERROR_CODES.STREAM_PROTOCOL_FAILED, "Model stream ended without a terminal event", {
				provider: model.provider,
				modelId: model.id,
			}),
		);
	} catch (error) {
		failLanguageModelStream(target, model, error);
	} finally {
		await iterator.return?.();
	}
}

function observePromise<T>(promise: Promise<T>): void {
	void promise.catch(() => undefined);
}

function isRoutingCommitEvent(event: AssistantMessageEvent): boolean {
	return event.type !== "start" && event.type !== "error";
}

function isFallbackError(error: unknown, policy: ModelRoutePolicy): boolean {
	if (!policy.fallbackCodes || policy.fallbackCodes.length === 0) return false;
	return error instanceof AIError && policy.fallbackCodes.includes(error.code);
}
