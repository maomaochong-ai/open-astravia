import { LangfuseSpanProcessor, type LangfuseSpanProcessorParams } from "@langfuse/otel";
import {
	type LangfuseObservation,
	type LangfuseObservationAttributes,
	type PropagateAttributesParams,
	propagateAttributes,
	startObservation,
} from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type {
	RuntimeObservation,
	RuntimeObservationStartOptions,
	RuntimeObservationType,
	RuntimeObservationUpdate,
	RuntimeTracer,
} from "./index.js";

export interface LangfuseRuntimeTracerOptions extends LangfuseSpanProcessorParams {
	serviceName?: string;
}

let sdk: NodeSDK | undefined;
let spanProcessor: LangfuseSpanProcessor | undefined;

export function createLangfuseRuntimeTracer(options: LangfuseRuntimeTracerOptions = {}): RuntimeTracer {
	if (!sdk || !spanProcessor) {
		const { serviceName, ...processorOptions } = options;
		spanProcessor = new LangfuseSpanProcessor(processorOptions);
		sdk = new NodeSDK({
			serviceName: serviceName ?? "astravia-agent",
			spanProcessors: [spanProcessor],
		});
		sdk.start();
	}

	return new LangfuseRuntimeTracer(sdk, spanProcessor);
}

export function createLangfuseRuntimeTracerFromEnv(env: NodeJS.ProcessEnv = process.env): RuntimeTracer | undefined {
	if (env.ASTRAVIA_TRACING !== "langfuse") {
		return undefined;
	}

	return createLangfuseRuntimeTracer({
		baseUrl: env.LANGFUSE_BASE_URL,
		publicKey: env.LANGFUSE_PUBLIC_KEY,
		secretKey: env.LANGFUSE_SECRET_KEY,
		environment: env.LANGFUSE_TRACING_ENVIRONMENT,
		release: env.LANGFUSE_RELEASE,
		serviceName: env.OTEL_SERVICE_NAME ?? "astravia-agent",
	});
}

class LangfuseRuntimeTracer implements RuntimeTracer {
	constructor(
		private readonly sdkInstance: NodeSDK,
		private readonly processor: LangfuseSpanProcessor,
	) {}

	startObservation(
		name: string,
		update?: RuntimeObservationUpdate,
		options?: RuntimeObservationStartOptions,
	): RuntimeObservation {
		return new LangfuseRuntimeObservation(startLangfuseObservation(undefined, name, update, options));
	}

	async flush(): Promise<void> {
		await this.processor.forceFlush();
	}

	async shutdown(): Promise<void> {
		await this.sdkInstance.shutdown();
	}
}

class LangfuseRuntimeObservation implements RuntimeObservation {
	readonly id: string;
	readonly traceId: string;
	readonly type: RuntimeObservationType;

	constructor(private readonly observation: LangfuseObservation) {
		this.id = observation.id;
		this.traceId = observation.traceId;
		this.type = toRuntimeObservationType(observation.type);
	}

	startObservation(
		name: string,
		update?: RuntimeObservationUpdate,
		options?: RuntimeObservationStartOptions,
	): RuntimeObservation {
		return new LangfuseRuntimeObservation(startLangfuseObservation(this.observation, name, update, options));
	}

	update(update: RuntimeObservationUpdate): void {
		updateLangfuseObservation(this.observation, update);
	}

	end(update?: RuntimeObservationUpdate): void {
		if (update) {
			this.update(update);
		}
		this.observation.end();
	}
}

function startLangfuseObservation(
	parent: LangfuseObservation | undefined,
	name: string,
	update?: RuntimeObservationUpdate,
	options?: RuntimeObservationStartOptions,
): LangfuseObservation {
	const type = options?.type ?? "span";
	const attributes = toLangfuseAttributes(update);

	return propagateTraceAttributes(update, () => {
		switch (type) {
			case "agent":
				return parent
					? parent.startObservation(name, attributes, { asType: "agent" })
					: startObservation(name, attributes, { asType: "agent" });
			case "event":
				return parent
					? parent.startObservation(name, attributes, { asType: "event" })
					: startObservation(name, attributes, { asType: "event" });
			case "generation":
				return parent
					? parent.startObservation(name, attributes, { asType: "generation" })
					: startObservation(name, attributes, { asType: "generation" });
			case "tool":
				return parent
					? parent.startObservation(name, attributes, { asType: "tool" })
					: startObservation(name, attributes, { asType: "tool" });
			case "span":
				return parent
					? parent.startObservation(name, attributes, { asType: "span" })
					: startObservation(name, attributes, { asType: "span" });
		}
	});
}

function updateLangfuseObservation(observation: LangfuseObservation, update: RuntimeObservationUpdate): void {
	const attributes = toLangfuseAttributes(update);

	if ("update" in observation) {
		observation.update(attributes);
	}
}

function toLangfuseAttributes(update: RuntimeObservationUpdate | undefined): LangfuseObservationAttributes {
	if (!update) {
		return {};
	}

	const attributes: LangfuseObservationAttributes = {};
	if (update.input !== undefined) attributes.input = update.input;
	if (update.output !== undefined) attributes.output = update.output;
	if (update.metadata !== undefined) attributes.metadata = update.metadata;
	if (update.level !== undefined) attributes.level = update.level;
	if (update.statusMessage !== undefined) attributes.statusMessage = update.statusMessage;
	if (update.version !== undefined) attributes.version = update.version;
	if (update.model !== undefined) attributes.model = update.model;
	if (update.modelParameters !== undefined) attributes.modelParameters = update.modelParameters;
	if (update.usageDetails !== undefined) attributes.usageDetails = compactNumberRecord(update.usageDetails);
	if (update.costDetails !== undefined) attributes.costDetails = compactNumberRecord(update.costDetails);

	return attributes;
}

function propagateTraceAttributes<T>(update: RuntimeObservationUpdate | undefined, fn: () => T): T {
	const params = toPropagationParams(update);
	return params ? propagateAttributes(params, fn) : fn();
}

function toPropagationParams(update: RuntimeObservationUpdate | undefined): PropagateAttributesParams | undefined {
	if (!update) {
		return undefined;
	}

	const params: PropagateAttributesParams = {};
	if (update.userId) params.userId = update.userId;
	if (update.sessionId) params.sessionId = update.sessionId;
	if (update.traceName) params.traceName = update.traceName;
	if (update.tags && update.tags.length > 0) params.tags = update.tags;
	if (update.version) params.version = update.version;

	return Object.keys(params).length > 0 ? params : undefined;
}

function toRuntimeObservationType(type: LangfuseObservation["type"]): RuntimeObservationType {
	switch (type) {
		case "agent":
		case "event":
		case "generation":
		case "tool":
		case "span":
			return type;
		default:
			return "span";
	}
}

function compactNumberRecord(record: Record<string, number | undefined>): Record<string, number> {
	const compacted: Record<string, number> = {};
	for (const [key, value] of Object.entries(record)) {
		if (typeof value === "number" && Number.isFinite(value)) {
			compacted[key] = value;
		}
	}
	return compacted;
}
