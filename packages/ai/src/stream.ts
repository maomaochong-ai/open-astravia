import "./providers/register-builtins.js";
import "./utils/http-proxy.js";

import { getApiProvider, getApiProviderSource } from "./api-registry.js";
import { projectLanguageModelAdapter, projectLanguageModelSimpleAdapter } from "./providers/legacy-adapter-stream.js";
import { getDefaultAdapterRegistry } from "./runtime/default-adapter-registry.js";
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	ProviderStreamOptions,
	SimpleStreamOptions,
	StreamOptions,
} from "./types.js";
import type { AssistantMessageEventStream } from "./utils/event-stream.js";

export { getEnvApiKey } from "./env-api-keys.js";

function resolveApiProvider(api: Api) {
	const provider = getApiProvider(api);
	if (!provider) {
		throw new Error(`No API provider registered for api: ${api}`);
	}
	return provider;
}

function resolveNativeAdapter(api: Api) {
	return getDefaultAdapterRegistry().get(api);
}

function shouldUseNativeAdapter(api: Api): boolean {
	const nativeAdapter = resolveNativeAdapter(api);
	if (!nativeAdapter) return false;
	const legacySource = getApiProviderSource(api);
	return legacySource === undefined || legacySource === "built-in";
}

function shouldUseNativeSimpleAdapter(api: Api): boolean {
	const nativeAdapter = resolveNativeAdapter(api);
	if (!nativeAdapter?.streamSimple) return false;
	const legacySource = getApiProviderSource(api);
	return legacySource === undefined || legacySource === "built-in";
}

export function stream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): AssistantMessageEventStream {
	const nativeAdapter = resolveNativeAdapter(model.api);
	if (nativeAdapter && shouldUseNativeAdapter(model.api)) {
		return projectLanguageModelAdapter(nativeAdapter, model, context, options as StreamOptions);
	}
	const provider = resolveApiProvider(model.api);
	return provider.stream(model, context, options as StreamOptions);
}

export async function complete<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): Promise<AssistantMessage> {
	const s = stream(model, context, options);
	return s.result();
}

export function streamSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const nativeAdapter = resolveNativeAdapter(model.api);
	if (nativeAdapter?.streamSimple && shouldUseNativeSimpleAdapter(model.api)) {
		return projectLanguageModelSimpleAdapter(nativeAdapter, model, context, options);
	}
	const provider = resolveApiProvider(model.api);
	return provider.streamSimple(model, context, options);
}

export async function completeSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
	const s = streamSimple(model, context, options);
	return s.result();
}
