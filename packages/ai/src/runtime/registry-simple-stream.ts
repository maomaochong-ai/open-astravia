import type { Api, Context } from "../protocol/index.js";
import { projectLanguageModelSimpleAdapter } from "../providers/legacy-adapter-stream.js";
import type { Model, SimpleStreamOptions } from "../types.js";
import type { AssistantMessageEventStream } from "../utils/event-stream.js";
import type { AdapterRegistry } from "./adapter-registry.js";

export type SimpleStreamFunction = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export interface CreateRegistrySimpleStreamOptions {
	readonly fallback?: SimpleStreamFunction;
	readonly shouldUseAdapter?: (model: Model<Api>) => boolean;
}

/** Creates an isolated simple-stream entry point backed by the supplied registry. */
export function createRegistrySimpleStream(
	registry: AdapterRegistry,
	configuration: CreateRegistrySimpleStreamOptions = {},
): SimpleStreamFunction {
	return (model, context, streamOptions) => {
		const adapter = registry.get(model.api);
		if (adapter?.streamSimple && (configuration.shouldUseAdapter?.(model) ?? true)) {
			return projectLanguageModelSimpleAdapter(adapter, model, context, streamOptions);
		}
		if (configuration.fallback) return configuration.fallback(model, context, streamOptions);
		throw new Error(`No simple-stream Adapter registered for API: ${model.api}`);
	};
}
