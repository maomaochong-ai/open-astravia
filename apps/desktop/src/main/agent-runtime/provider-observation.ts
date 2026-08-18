import { appendFile } from "node:fs/promises";
import {
	AdapterRegistry,
	createRegistrySimpleStream,
	getApiProviderSource,
	registerBuiltInAdapters,
	type SimpleStreamFunction,
	streamSimple,
} from "@vetta/ai";
import {
	createProviderObservationMiddleware,
	type ProviderCallObservation,
	type ProviderObservationCapture,
	type ProviderObservationSink,
} from "@vetta/ai/testing";
import { type ApplicationCacheService, getApplicationCacheService } from "../cache/application-cache-service.js";

const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const CACHE_NAMESPACE = "provider-observations";

export interface DesktopProviderObservationRuntime {
	readonly streamFn: SimpleStreamFunction;
	readonly tracePath: string;
}

export interface CreateDesktopProviderObservationRuntimeOptions {
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly cacheService?: ApplicationCacheService;
}

let desktopProviderObservationRuntime: DesktopProviderObservationRuntime | undefined;

/** Returns one isolated observation pipeline for Desktop verification runs. */
export function getDesktopProviderObservationRuntime(): DesktopProviderObservationRuntime | undefined {
	desktopProviderObservationRuntime ??= createDesktopProviderObservationRuntime();
	return desktopProviderObservationRuntime;
}

export function createDesktopProviderObservationRuntime(
	options: CreateDesktopProviderObservationRuntimeOptions = {},
): DesktopProviderObservationRuntime | undefined {
	const environment = options.environment ?? process.env;
	if (environment.VETTA_UI_VERIFICATION !== "1") return undefined;
	const runId = environment.VETTA_PROVIDER_OBSERVATION_RUN_ID;
	if (!runId) return undefined;
	if (!RUN_ID_PATTERN.test(runId)) {
		throw new Error("VETTA_PROVIDER_OBSERVATION_RUN_ID must contain 1-64 letters, numbers, underscores, or hyphens");
	}
	const capture = parseCapture(environment.VETTA_PROVIDER_OBSERVATION_CAPTURE);
	const namespace = (options.cacheService ?? getApplicationCacheService()).namespace(CACHE_NAMESPACE);
	const tracePath = namespace.path(`${runId}.ndjson`);
	const sink = new NdjsonProviderObservationSink(namespace.ensure(), tracePath);
	const registry = new AdapterRegistry();
	registerBuiltInAdapters(registry, {
		sourceId: `provider-observation:${runId}`,
		middleware: [createProviderObservationMiddleware({ capture, sink })],
	});

	return {
		tracePath,
		streamFn: createRegistrySimpleStream(registry, {
			fallback: (model, context, streamOptions) => streamSimple(model, context, streamOptions),
			shouldUseAdapter(model) {
				const legacySource = getApiProviderSource(model.api);
				return legacySource === undefined || legacySource === "built-in";
			},
		}),
	};
}

function parseCapture(value: string | undefined): ProviderObservationCapture {
	if (value === undefined || value === "metadata") return "metadata";
	if (value === "payload" || value === "wire") return value;
	throw new Error("VETTA_PROVIDER_OBSERVATION_CAPTURE must be metadata, payload, or wire");
}

export class NdjsonProviderObservationSink implements ProviderObservationSink {
	#writeQueue: Promise<void>;

	constructor(
		ready: Promise<void>,
		private readonly tracePath: string,
	) {
		this.#writeQueue = ready;
	}

	record(observation: ProviderCallObservation): Promise<void> {
		this.#writeQueue = this.#writeQueue
			.catch(() => undefined)
			.then(async () => appendFile(this.tracePath, `${JSON.stringify(observation)}\n`, "utf-8"));
		return this.#writeQueue;
	}
}
