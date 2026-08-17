import { createPromptCacheDiagnostics } from "../protocol/index.js";
import type {
	ModelCallRequest,
	ModelGenerateResponse,
	ModelStreamResponse,
} from "../runtime/language-model-adapter.js";
import type { ModelCallMetadata, ModelCallResult } from "../runtime/model-call-result.js";
import type { ModelMiddleware } from "../runtime/model-middleware.js";
import type { FetchFunction, StreamOptions } from "../types.js";
import type {
	ProviderCallObservation,
	ProviderObservationCapture,
	ProviderObservationError,
	ProviderObservationSink,
	ProviderObservationValue,
	ProviderWireObservation,
} from "./provider-observation-contracts.js";
import {
	sanitizeProviderObservationHeaders,
	sanitizeProviderObservationUrl,
	sanitizeProviderObservationValue,
} from "./provider-observation-sanitizer.js";

export interface CreateProviderObservationMiddlewareOptions {
	readonly sink: ProviderObservationSink;
	readonly capture?: ProviderObservationCapture;
	readonly now?: () => number;
	readonly createCallId?: () => string;
	readonly maxWireBodyLength?: number;
}

interface ObservationState {
	readonly request: ModelCallRequest;
	readonly capture: ProviderObservationCapture;
	readonly callId: string;
	readonly startedAt: number;
	readonly wire: ProviderWireObservation[];
	readonly pendingWireBodies: Promise<void>[];
	payload?: ProviderObservationValue;
	recorded: boolean;
}

let nextCallId = 0;

/**
 * Observes the native Adapter boundary without changing provider events or results.
 * Sink and capture failures are deliberately isolated from the model call.
 */
export function createProviderObservationMiddleware(
	options: CreateProviderObservationMiddlewareOptions,
): ModelMiddleware {
	const capture = options.capture ?? "metadata";
	const now = options.now ?? Date.now;
	const createCallId = options.createCallId ?? (() => `provider-call-${now()}-${++nextCallId}`);

	const observeStream = async (
		request: ModelCallRequest,
		next: (nextRequest: ModelCallRequest) => Promise<ModelStreamResponse>,
	): Promise<ModelStreamResponse> => {
		const state = createState(request, capture, createCallId(), now());
		try {
			const response = await next(decorateRequest(request, state, options.maxWireBodyLength));
			void observeStreamResult(state, response, options.sink, now);
			return response;
		} catch (error) {
			void recordObservation(state, options.sink, now, undefined, undefined, error);
			throw error;
		}
	};

	return {
		name: "provider-observation",
		wrapStream: observeStream,
		wrapStreamSimple: observeStream,
		async wrapGenerate(request, next) {
			const state = createState(request, capture, createCallId(), now());
			try {
				const response = await next(decorateRequest(request, state, options.maxWireBodyLength));
				void observeGenerateResult(state, response, options.sink, now);
				return response;
			} catch (error) {
				void recordObservation(state, options.sink, now, undefined, undefined, error);
				throw error;
			}
		},
	};
}

function createState(
	request: ModelCallRequest,
	capture: ProviderObservationCapture,
	callId: string,
	startedAt: number,
): ObservationState {
	return { request, capture, callId, startedAt, wire: [], pendingWireBodies: [], recorded: false };
}

function decorateRequest(
	request: ModelCallRequest,
	state: ObservationState,
	maxWireBodyLength = 65_536,
): ModelCallRequest {
	if (state.capture === "metadata") return request;
	const currentOptions = request.options;
	const onPayload = currentOptions?.onPayload;
	const observedOptions: StreamOptions = {
		...currentOptions,
		onPayload(payload) {
			try {
				state.payload = sanitizeProviderObservationValue(payload);
			} catch {
				// Observability must never alter provider behavior.
			}
			onPayload?.(payload);
		},
	};
	if (state.capture === "wire") {
		observedOptions.fetch = createObservedFetch(currentOptions?.fetch ?? globalThis.fetch, state, maxWireBodyLength);
	}
	return { ...request, options: observedOptions };
}

function createObservedFetch(
	fetchImplementation: FetchFunction,
	state: ObservationState,
	maxWireBodyLength: number,
): FetchFunction {
	return async (input, init) => {
		const request = new Request(input, init);
		const exchange: ProviderWireObservation = {
			request: {
				url: sanitizeProviderObservationUrl(request.url),
				method: request.method,
				headers: sanitizeProviderObservationHeaders(request.headers),
				...(typeof init?.body === "string" ? { body: sanitizeWireBody(init.body, maxWireBodyLength) } : {}),
			},
		};
		state.wire.push(exchange);
		try {
			const response = await fetchImplementation(input, init);
			exchange.response = {
				status: response.status,
				statusText: response.statusText,
				headers: sanitizeProviderObservationHeaders(response.headers),
			};
			const bodyCapture = captureResponseBody(response.clone(), exchange, maxWireBodyLength);
			state.pendingWireBodies.push(bodyCapture);
			return response;
		} catch (error) {
			exchange.error = toObservationError(error);
			throw error;
		}
	};
}

async function captureResponseBody(
	response: Response,
	exchange: ProviderWireObservation,
	maxWireBodyLength: number,
): Promise<void> {
	try {
		const body = await response.text();
		if (exchange.response) exchange.response.body = sanitizeWireBody(body, maxWireBodyLength);
	} catch (error) {
		exchange.error = toObservationError(error);
	}
}

function sanitizeWireBody(body: string, maximum: number): ProviderObservationValue {
	try {
		return sanitizeProviderObservationValue(JSON.parse(body), { maxStringLength: maximum });
	} catch {
		const limited =
			body.length <= maximum ? body : `${body.slice(0, maximum)}...[truncated ${body.length - maximum} chars]`;
		return redactUnstructuredSecrets(limited);
	}
}

async function observeStreamResult(
	state: ObservationState,
	response: ModelStreamResponse,
	sink: ProviderObservationSink,
	now: () => number,
): Promise<void> {
	try {
		const [message, metadata] = await Promise.all([
			response.result,
			response.metadata?.catch(() => undefined) ?? Promise.resolve(undefined),
		]);
		await recordObservation(state, sink, now, message.stopReason, metadata, undefined, message.usage);
	} catch (error) {
		await recordObservation(state, sink, now, undefined, undefined, error);
	}
}

async function observeGenerateResult(
	state: ObservationState,
	response: ModelGenerateResponse,
	sink: ProviderObservationSink,
	now: () => number,
): Promise<void> {
	try {
		const result = await response.result;
		await recordObservation(state, sink, now, result.message.stopReason, result, undefined, result.usage);
	} catch (error) {
		await recordObservation(state, sink, now, undefined, undefined, error);
	}
}

async function recordObservation(
	state: ObservationState,
	sink: ProviderObservationSink,
	now: () => number,
	stopReason?: string,
	metadata?: ModelCallMetadata | ModelCallResult,
	error?: unknown,
	usage?: ModelCallResult["usage"],
): Promise<void> {
	if (state.recorded) return;
	state.recorded = true;
	await Promise.allSettled(state.pendingWireBodies);
	const observation: ProviderCallObservation = {
		schemaVersion: 1,
		callId: state.callId,
		startedAt: new Date(state.startedAt).toISOString(),
		durationMs: Math.max(0, now() - state.startedAt),
		capture: state.capture,
		model: {
			api: state.request.model.api,
			provider: state.request.model.provider,
			id: state.request.model.id,
		},
		...(state.request.options?.sessionId ? { sessionId: state.request.options.sessionId } : {}),
		request: {
			promptCache: createPromptCacheDiagnostics(state.request.context),
			messageCount: state.request.context.messages.length,
			toolCount: state.request.context.tools?.length ?? 0,
			...(state.payload === undefined ? {} : { payload: state.payload }),
			...(state.capture === "wire" ? { wire: state.wire } : {}),
		},
		...(stopReason && usage
			? {
					response: {
						stopReason,
						usage,
						...(metadata === undefined ? {} : { metadata: sanitizeProviderObservationValue(metadata) }),
					},
				}
			: {}),
		...(error === undefined ? {} : { error: toObservationError(error) }),
	};
	try {
		await sink.record(observation);
	} catch {
		// The test observer is intentionally non-interfering.
	}
}

function toObservationError(error: unknown): ProviderObservationError {
	return error instanceof Error
		? { name: error.name, message: redactUnstructuredSecrets(error.message) }
		: { name: "Error", message: redactUnstructuredSecrets(String(error)) };
}

function redactUnstructuredSecrets(value: string): string {
	return value
		.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
		.replace(
			/((?:api[-_]?key|access[-_]?key|access[-_]?token|token|secret|password)\s*[=:]\s*)[^\s&,;"']+/gi,
			"$1[REDACTED]",
		);
}
