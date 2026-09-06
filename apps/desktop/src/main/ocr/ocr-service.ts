import { randomUUID } from "node:crypto";
import {
	CAPABILITY_ERROR_CODES,
	CapabilityError,
	type OcrInput,
	type OcrProviderDescriptor,
	type OcrProviderInput,
	type OcrRequest,
	type OcrResult,
} from "@vetta/capability-sdk";
import {
	DEFAULT_OCR_PROVIDER_ID,
	type OcrRemoteProviderPolicy,
	VETTA_OCR_CONFIGURATION,
	type VettaOcrConfiguration,
} from "@vetta/runtime-tools";
import type { OcrProviderContext, OcrProviderRegistry } from "./ocr-provider-registry.js";

export interface OcrServiceInputResolver {
	getInputPath(input: OcrInput): Promise<string>;
}

export interface OcrServiceOptions {
	registry: OcrProviderRegistry;
	readConfiguration(): unknown;
	createInvocationId?: () => string;
}

export interface OcrServiceCallOptions {
	signal: AbortSignal;
	inputResolver: OcrServiceInputResolver;
	reportProgress?: OcrProviderContext["reportProgress"];
}

export class OcrService {
	constructor(private readonly options: OcrServiceOptions) {}

	listProviders(): OcrProviderDescriptor[] {
		return this.options.registry.listProviders();
	}

	readConfiguration(): VettaOcrConfiguration {
		const persisted = this.options.readConfiguration();
		const value = isRecord(persisted)
			? mergeConfiguration(VETTA_OCR_CONFIGURATION.defaultValue, persisted)
			: VETTA_OCR_CONFIGURATION.defaultValue;
		return VETTA_OCR_CONFIGURATION.codec.decode(value);
	}

	async recognize(request: OcrRequest, options: OcrServiceCallOptions): Promise<OcrResult> {
		if (options.signal.aborted) throw aborted();
		const configuration = this.readConfiguration();
		const providerId = request.providerId ?? configuration.defaultProviderId ?? DEFAULT_OCR_PROVIDER_ID;
		const provider = this.options.registry.get(providerId);
		if (!provider || provider.descriptor.status !== "ready") {
			throw new CapabilityError(CAPABILITY_ERROR_CODES.NOT_FOUND, `OCR provider unavailable: ${providerId}`);
		}
		assertRemotePolicy(provider.descriptor, configuration.remoteProviderPolicy);
		const { inputs, sources } = qualifyInputs(request.inputs);
		assertCompatible(provider.descriptor, inputs, request.granularity);
		const result = await provider.recognize(
			{ languages: request.languages, granularity: request.granularity, inputs },
			{
				signal: options.signal,
				invocationId: this.options.createInvocationId?.() ?? randomUUID(),
				getInputPath: async (inputId) => {
					const input = sources.get(inputId);
					if (!input) throw new Error(`OCR input unavailable: ${inputId}`);
					return options.inputResolver.getInputPath(input);
				},
				reportProgress: options.reportProgress ?? (() => undefined),
			},
		);
		if (options.signal.aborted) throw aborted();
		return validateResult(result, providerId, inputs);
	}
}

function qualifyInputs(inputs: OcrRequest["inputs"]): {
	inputs: OcrProviderInput[];
	sources: ReadonlyMap<string, OcrInput>;
} {
	const used = new Set<string>();
	const sources = new Map<string, OcrInput>();
	const qualified = inputs.map((input, index) => {
		const base = input.id?.trim() || `input-${index + 1}`;
		let id = base;
		for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
		used.add(id);
		sources.set(id, input);
		return { id, mimeType: input.mimeType };
	});
	return { inputs: qualified, sources };
}

function assertCompatible(
	descriptor: OcrProviderDescriptor,
	inputs: readonly OcrProviderInput[],
	granularity: OcrRequest["granularity"],
): void {
	const maxItems = descriptor.input.maxItemsPerRequest;
	if (maxItems !== undefined && inputs.length > maxItems) {
		throw new CapabilityError(CAPABILITY_ERROR_CODES.INVALID_INPUT, `OCR provider accepts at most ${maxItems} items`);
	}
	for (const input of inputs) {
		if (input.mimeType && !descriptor.input.mimeTypes.includes(input.mimeType)) {
			throw new CapabilityError(
				CAPABILITY_ERROR_CODES.INVALID_INPUT,
				`OCR provider does not support ${input.mimeType}`,
			);
		}
	}
	if (granularity && !descriptor.output.granularities.includes(granularity)) {
		throw new CapabilityError(
			CAPABILITY_ERROR_CODES.INVALID_INPUT,
			`OCR provider does not support ${granularity} output`,
		);
	}
}

function assertRemotePolicy(descriptor: OcrProviderDescriptor, policy: OcrRemoteProviderPolicy): void {
	if (descriptor.processing !== "remote") return;
	if (policy === "never") throw new Error("Remote OCR is disabled by Agent configuration");
	if (policy === "ask") throw new Error("Remote OCR requires confirmation in Agent configuration");
}

function validateResult(result: OcrResult, providerId: string, inputs: readonly OcrProviderInput[]): OcrResult {
	if (result.protocolVersion !== 1 || result.providerId !== providerId)
		throw new Error("OCR provider returned an invalid envelope");
	if (result.items.length !== inputs.length) throw new Error("OCR provider returned a mismatched item count");
	for (let index = 0; index < inputs.length; index += 1) {
		if (result.items[index]?.id !== inputs[index]?.id) throw new Error("OCR provider returned items out of order");
	}
	return result;
}

function mergeConfiguration(base: VettaOcrConfiguration, patch: Record<string, unknown>): Record<string, unknown> {
	return { ...base, ...patch };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function aborted(): CapabilityError {
	return new CapabilityError(CAPABILITY_ERROR_CODES.ABORTED, "OCR invocation was aborted");
}
