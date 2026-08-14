import type { Api } from "../protocol/index.js";
import type { SimpleStreamOptions } from "../types.js";
import type {
	LanguageModelAdapter,
	ModelCallRequest,
	ModelGenerateResponse,
	ModelStreamResponse,
} from "./language-model-adapter.js";

export interface ModelMiddleware {
	readonly name: string;
	readonly transformRequest?: (request: ModelCallRequest) => ModelCallRequest | Promise<ModelCallRequest>;
	readonly wrapStream?: (
		request: ModelCallRequest,
		next: (request: ModelCallRequest) => Promise<ModelStreamResponse>,
	) => Promise<ModelStreamResponse>;
	readonly wrapStreamSimple?: (
		request: ModelCallRequest,
		next: (request: ModelCallRequest) => Promise<ModelStreamResponse>,
	) => Promise<ModelStreamResponse>;
	readonly wrapGenerate?: (
		request: ModelCallRequest,
		next: (request: ModelCallRequest) => Promise<ModelGenerateResponse>,
	) => Promise<ModelGenerateResponse>;
}

export function withModelMiddleware<TApi extends Api>(
	adapter: LanguageModelAdapter<TApi>,
	middleware: readonly ModelMiddleware[],
): LanguageModelAdapter<TApi> {
	if (middleware.length === 0) return adapter;

	const transform = async (request: ModelCallRequest): Promise<ModelCallRequest> => {
		let current = request;
		for (const item of middleware) {
			if (item.transformRequest) current = await item.transformRequest(current);
		}
		return current;
	};

	const stream = async (request: ModelCallRequest): Promise<ModelStreamResponse> => {
		const transformed = await transform(request);
		const terminal = async (nextRequest: ModelCallRequest): Promise<ModelStreamResponse> =>
			adapter.stream(nextRequest as unknown as ModelCallRequest<TApi>);
		let next = terminal;
		for (const item of [...middleware].reverse()) {
			if (!item.wrapStream) continue;
			const previous = next;
			next = (nextRequest) => item.wrapStream!(nextRequest, previous);
		}
		return next(transformed);
	};

	const streamSimple = adapter.streamSimple
		? async (request: ModelCallRequest): Promise<ModelStreamResponse> => {
				const transformed = await transform(request);
				const terminal = async (nextRequest: ModelCallRequest): Promise<ModelStreamResponse> =>
					adapter.streamSimple!(nextRequest as unknown as ModelCallRequest<TApi, SimpleStreamOptions>);
				let next = terminal;
				for (const item of [...middleware].reverse()) {
					if (!item.wrapStreamSimple) continue;
					const previous = next;
					next = (nextRequest) => item.wrapStreamSimple!(nextRequest, previous);
				}
				return next(transformed);
			}
		: undefined;

	const generate = adapter.generate
		? async (request: ModelCallRequest): Promise<ModelGenerateResponse> => {
				const transformed = await transform(request);
				const terminal = async (nextRequest: ModelCallRequest): Promise<ModelGenerateResponse> =>
					adapter.generate!(nextRequest as unknown as ModelCallRequest<TApi>);
				let next = terminal;
				for (const item of [...middleware].reverse()) {
					if (!item.wrapGenerate) continue;
					const previous = next;
					next = (nextRequest) => item.wrapGenerate!(nextRequest, previous);
				}
				return next(transformed);
			}
		: undefined;

	return {
		api: adapter.api,
		...(adapter.capabilities ? { capabilities: adapter.capabilities } : {}),
		stream,
		...(streamSimple ? { streamSimple } : {}),
		...(generate ? { generate } : {}),
	};
}

export function composeModelMiddleware(...middleware: readonly ModelMiddleware[][]): readonly ModelMiddleware[] {
	return middleware.flat();
}
