import type { RuntimeConfigurationDefinition, RuntimeConfigurationJsonObject } from "@vetta/runtime-core/configuration";

export const VETTA_OCR_CONFIGURATION_ID = "vetta.ocr";
export const DEFAULT_OCR_PROVIDER_ID = "desktop-app:ppocrv5";

export type OcrRemoteProviderPolicy = "never" | "ask" | "allowed";
export type OcrDefaultOutput = "text" | "line" | "word" | "document-tree";

export interface VettaOcrConfiguration extends RuntimeConfigurationJsonObject {
	readonly defaultProviderId: string;
	readonly remoteProviderPolicy: OcrRemoteProviderPolicy;
	readonly cacheResults: boolean;
	readonly defaultOutput: OcrDefaultOutput;
}

export const VETTA_OCR_CONFIGURATION = Object.freeze({
	id: VETTA_OCR_CONFIGURATION_ID,
	schemaVersion: 1,
	descriptor: {
		title: "Text recognition (OCR)",
		description: "Controls the default OCR provider, remote-use policy, result cache, and output detail.",
		schema: {
			type: "object",
			additionalProperties: false,
			required: ["defaultProviderId", "remoteProviderPolicy", "cacheResults", "defaultOutput"],
			properties: {
				defaultProviderId: { type: "string", minLength: 1 },
				remoteProviderPolicy: { type: "enum", enum: ["never", "ask", "allowed"] },
				cacheResults: { type: "boolean" },
				defaultOutput: { type: "enum", enum: ["text", "line", "word", "document-tree"] },
			},
		},
		presentation: {
			group: "ocr",
			order: ["defaultProviderId", "remoteProviderPolicy", "cacheResults", "defaultOutput"],
			controls: { defaultProviderId: { kind: "ocr-provider-select" } },
		},
	},
	codec: { decode: decodeVettaOcrConfiguration },
	defaultValue: {
		defaultProviderId: DEFAULT_OCR_PROVIDER_ID,
		remoteProviderPolicy: "ask",
		cacheResults: true,
		defaultOutput: "text",
	},
	apply: "next-turn",
} satisfies RuntimeConfigurationDefinition<VettaOcrConfiguration>);

function decodeVettaOcrConfiguration(value: unknown): VettaOcrConfiguration {
	if (!isRecord(value)) throw new TypeError("Invalid OCR configuration");
	const defaultProviderId = nonEmptyString(value.defaultProviderId, "defaultProviderId");
	if (!isRemotePolicy(value.remoteProviderPolicy)) throw new TypeError("Invalid OCR remote provider policy");
	if (typeof value.cacheResults !== "boolean") throw new TypeError("Invalid OCR cache configuration");
	if (!isOutput(value.defaultOutput)) throw new TypeError("Invalid OCR default output");
	return {
		defaultProviderId,
		remoteProviderPolicy: value.remoteProviderPolicy,
		cacheResults: value.cacheResults,
		defaultOutput: value.defaultOutput,
	};
}

function nonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
		throw new TypeError(`Invalid OCR configuration field: ${field}`);
	}
	return value;
}

function isRemotePolicy(value: unknown): value is OcrRemoteProviderPolicy {
	return value === "never" || value === "ask" || value === "allowed";
}

function isOutput(value: unknown): value is OcrDefaultOutput {
	return value === "text" || value === "line" || value === "word" || value === "document-tree";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
