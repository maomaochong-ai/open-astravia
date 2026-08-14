import {
	AI_ERROR_CODES,
	AIError,
	type Api,
	type Context,
	createAssistantMessage,
	getAIErrorDetails,
} from "../protocol/index.js";
import { normalizeProviderError } from "../provider-kit/provider-error.js";
import type { Model, SimpleStreamOptions, StreamFunction, StreamOptions } from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import {
	type LanguageModelAdapter,
	normalizeLanguageModelGenerateResponse,
	normalizeLanguageModelResponse,
	type RegisteredLanguageModelAdapter,
} from "./language-model-adapter.js";
import { type ModelMiddleware, withModelMiddleware } from "./model-middleware.js";

export type ApiStreamFunction = (
	model: Model<Api>,
	context: Context,
	options?: StreamOptions,
) => AssistantMessageEventStream;

export type ApiStreamSimpleFunction = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export interface ApiProvider<TApi extends Api = Api, TOptions extends StreamOptions = StreamOptions> {
	api: TApi;
	stream: StreamFunction<TApi, TOptions>;
	streamSimple: StreamFunction<TApi, SimpleStreamOptions>;
}

export interface RegisteredApiProvider {
	api: Api;
	stream: ApiStreamFunction;
	streamSimple: ApiStreamSimpleFunction;
}

export interface AdapterRegistrationOptions {
	sourceId?: string;
	replace?: boolean;
	middleware?: readonly ModelMiddleware[];
}

interface LegacyApiProviderRegistryEntry {
	provider: RegisteredApiProvider;
	sourceId?: string;
}

interface AdapterRegistryEntry {
	adapter: RegisteredLanguageModelAdapter;
	sourceId?: string;
}

export class ApiProviderRegistrationError extends AIError {
	constructor(api: Api, existingSourceId?: string, sourceId?: string) {
		super(AI_ERROR_CODES.INVALID_REQUEST, `API provider is already registered: ${api}`, {
			metadata: { api, existingSourceId, sourceId },
		});
		this.name = "ApiProviderRegistrationError";
	}
}

export class LegacyApiProviderRegistry {
	readonly #entries = new Map<string, LegacyApiProviderRegistryEntry>();

	register<TApi extends Api, TOptions extends StreamOptions>(
		provider: ApiProvider<TApi, TOptions>,
		options: AdapterRegistrationOptions = {},
	): void {
		const existing = this.#entries.get(provider.api);
		if (existing && !options.replace) {
			throw new ApiProviderRegistrationError(provider.api, existing.sourceId, options.sourceId);
		}
		this.#entries.set(provider.api, {
			provider: {
				api: provider.api,
				stream: wrapStream(provider.api, provider.stream),
				streamSimple: wrapStreamSimple(provider.api, provider.streamSimple),
			},
			sourceId: options.sourceId,
		});
	}

	get(api: Api): RegisteredApiProvider | undefined {
		return this.#entries.get(api)?.provider;
	}

	getSource(api: Api): string | undefined {
		return this.#entries.get(api)?.sourceId;
	}

	getAll(): RegisteredApiProvider[] {
		return Array.from(this.#entries.values(), (entry) => entry.provider);
	}

	unregisterSource(sourceId: string): void {
		for (const [api, entry] of this.#entries.entries()) {
			if (entry.sourceId === sourceId) this.#entries.delete(api);
		}
	}

	clear(): void {
		this.#entries.clear();
	}
}

export class AdapterRegistry {
	readonly #entries = new Map<string, AdapterRegistryEntry>();

	register<TApi extends Api, TOptions extends StreamOptions>(
		adapter: LanguageModelAdapter<TApi, TOptions>,
		options: AdapterRegistrationOptions = {},
	): void {
		const effectiveAdapter = withModelMiddleware(adapter, options.middleware ?? []);
		const existing = this.#entries.get(effectiveAdapter.api);
		if (existing && !options.replace) {
			throw new ApiProviderRegistrationError(adapter.api, existing.sourceId, options.sourceId);
		}
		this.#entries.set(effectiveAdapter.api, {
			adapter: {
				api: effectiveAdapter.api,
				...(effectiveAdapter.capabilities ? { capabilities: effectiveAdapter.capabilities } : {}),
				stream: wrapAdapterStream(effectiveAdapter.api, effectiveAdapter.stream),
				...(effectiveAdapter.streamSimple
					? { streamSimple: wrapAdapterSimpleStream(effectiveAdapter.api, effectiveAdapter.streamSimple) }
					: {}),
				...(effectiveAdapter.generate
					? { generate: wrapAdapterGenerate(effectiveAdapter.api, effectiveAdapter.generate) }
					: {}),
			},
			sourceId: options.sourceId,
		});
	}

	get(api: Api): RegisteredLanguageModelAdapter | undefined {
		return this.#entries.get(api)?.adapter;
	}

	getAll(): RegisteredLanguageModelAdapter[] {
		return Array.from(this.#entries.values(), (entry) => entry.adapter);
	}

	unregisterSource(sourceId: string): void {
		for (const [api, entry] of this.#entries.entries()) {
			if (entry.sourceId === sourceId) this.#entries.delete(api);
		}
	}

	clear(): void {
		this.#entries.clear();
	}
}

function wrapStream<TApi extends Api, TOptions extends StreamOptions>(
	api: TApi,
	stream: StreamFunction<TApi, TOptions>,
): ApiStreamFunction {
	return (model, context, options) => {
		assertMatchingApi(api, model.api);
		try {
			return stream(model as Model<TApi>, context, options as TOptions);
		} catch (error) {
			return createLegacyProviderErrorStream(model, error);
		}
	};
}

function wrapStreamSimple<TApi extends Api>(
	api: TApi,
	streamSimple: StreamFunction<TApi, SimpleStreamOptions>,
): ApiStreamSimpleFunction {
	return (model, context, options) => {
		assertMatchingApi(api, model.api);
		try {
			return streamSimple(model as Model<TApi>, context, options);
		} catch (error) {
			return createLegacyProviderErrorStream(model, error);
		}
	};
}

function createLegacyProviderErrorStream(model: Model<Api>, error: unknown): AssistantMessageEventStream {
	const normalized = normalizeProviderError(error, model);
	const stream = new AssistantMessageEventStream();
	const reason = normalized.code === AI_ERROR_CODES.ABORTED ? "aborted" : "error";
	stream.push({
		type: "error",
		reason,
		error: createAssistantMessage(
			{ api: model.api, provider: model.provider, model: model.id },
			{ stopReason: reason, errorMessage: normalized.message, failure: getAIErrorDetails(normalized) },
		),
		failure: getAIErrorDetails(normalized),
	});
	return stream;
}

function wrapAdapterStream<TApi extends Api, TOptions extends StreamOptions>(
	api: TApi,
	stream: LanguageModelAdapter<TApi, TOptions>["stream"],
): RegisteredLanguageModelAdapter["stream"] {
	return async (request) => {
		try {
			assertMatchingApi(api, request.model.api);
			const response = await stream({
				model: request.model as Model<TApi>,
				context: request.context,
				options: request.options as TOptions,
			});
			return normalizeLanguageModelResponse(response, request.model as Model<TApi>);
		} catch (error) {
			throw normalizeProviderError(error, request.model);
		}
	};
}

function wrapAdapterSimpleStream<TApi extends Api>(
	api: TApi,
	streamSimple: NonNullable<LanguageModelAdapter<TApi>["streamSimple"]>,
): NonNullable<RegisteredLanguageModelAdapter["streamSimple"]> {
	return async (request) => {
		try {
			assertMatchingApi(api, request.model.api);
			const response = await streamSimple({
				model: request.model as Model<TApi>,
				context: request.context,
				options: request.options as SimpleStreamOptions,
			});
			return normalizeLanguageModelResponse(response, request.model as Model<TApi>);
		} catch (error) {
			throw normalizeProviderError(error, request.model);
		}
	};
}

function wrapAdapterGenerate<TApi extends Api, TOptions extends StreamOptions>(
	api: TApi,
	generate: NonNullable<LanguageModelAdapter<TApi, TOptions>["generate"]>,
): NonNullable<RegisteredLanguageModelAdapter["generate"]> {
	return async (request) => {
		try {
			assertMatchingApi(api, request.model.api);
			const response = await generate({
				model: request.model as Model<TApi>,
				context: request.context,
				options: request.options as TOptions,
			});
			return normalizeLanguageModelGenerateResponse(response, request.model as Model<TApi>);
		} catch (error) {
			throw normalizeProviderError(error, request.model);
		}
	};
}

function assertMatchingApi(expected: Api, actual: Api): void {
	if (actual === expected) return;
	throw new AIError(AI_ERROR_CODES.INVALID_REQUEST, `Mismatched api: ${actual} expected ${expected}`, {
		metadata: { actualApi: actual, expectedApi: expected },
	});
}
