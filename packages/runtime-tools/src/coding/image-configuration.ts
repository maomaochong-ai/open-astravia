import type { RuntimeConfigurationDefinition, RuntimeConfigurationJsonObject } from "@vetta/runtime-core/configuration";

export const CODING_IMAGE_CONFIGURATION_ID = "coding.images";

export interface CodingImageResizeConfiguration extends RuntimeConfigurationJsonObject {
	readonly maxWidth: number;
	readonly maxHeight: number;
	readonly maxInputPixels: number;
	readonly maxInputEdge: number;
	readonly maxBytes: number;
	readonly jpegQuality: number;
}

export interface CodingImageRequestBudgetConfiguration extends RuntimeConfigurationJsonObject {
	readonly highWatermarkBytes: number;
	readonly lowWatermarkBytes: number;
}

export interface CodingImageConfiguration extends RuntimeConfigurationJsonObject {
	readonly autoResize: boolean;
	readonly blockImages: boolean;
	readonly resize: CodingImageResizeConfiguration;
	readonly requestBudget: CodingImageRequestBudgetConfiguration;
}

export const CODING_IMAGE_CONFIGURATION: RuntimeConfigurationDefinition<CodingImageConfiguration> = Object.freeze({
	id: CODING_IMAGE_CONFIGURATION_ID,
	schemaVersion: 1,
	descriptor: {
		title: "Image processing",
		description: "Controls image normalization, safety limits, compression and request budgeting.",
		schema: {
			type: "object",
			additionalProperties: false,
			required: ["autoResize", "blockImages", "resize", "requestBudget"],
			properties: {
				autoResize: { type: "boolean" },
				blockImages: { type: "boolean" },
				resize: {
					type: "object",
					additionalProperties: false,
					required: ["maxWidth", "maxHeight", "maxInputPixels", "maxInputEdge", "maxBytes", "jpegQuality"],
					properties: {
						maxWidth: { type: "integer", minimum: 1 },
						maxHeight: { type: "integer", minimum: 1 },
						maxInputPixels: { type: "integer", minimum: 1 },
						maxInputEdge: { type: "integer", minimum: 1 },
						maxBytes: { type: "integer", minimum: 1 },
						jpegQuality: { type: "integer", minimum: 1, maximum: 100 },
					},
				},
				requestBudget: {
					type: "object",
					additionalProperties: false,
					required: ["highWatermarkBytes", "lowWatermarkBytes"],
					properties: {
						highWatermarkBytes: { type: "integer", minimum: 1 },
						lowWatermarkBytes: { type: "integer", minimum: 1 },
					},
				},
			},
		},
		presentation: {
			group: "images",
			order: ["autoResize", "blockImages", "resize", "requestBudget"],
		},
	},
	codec: { decode: decodeCodingImageConfiguration },
	defaultValue: {
		autoResize: true,
		blockImages: false,
		resize: {
			maxWidth: 1280,
			maxHeight: 1280,
			maxInputPixels: 8000 * 8000,
			maxInputEdge: 12000,
			maxBytes: 2 * 1024 * 1024,
			jpegQuality: 70,
		},
		requestBudget: {
			highWatermarkBytes: 16 * 1024 * 1024,
			lowWatermarkBytes: 12 * 1024 * 1024,
		},
	},
	apply: "next-turn",
});

function decodeCodingImageConfiguration(value: unknown): CodingImageConfiguration {
	if (!isRecord(value) || typeof value.autoResize !== "boolean" || typeof value.blockImages !== "boolean") {
		throw new TypeError("Invalid image behavior configuration");
	}
	if (!isRecord(value.resize) || !isRecord(value.requestBudget)) {
		throw new TypeError("Invalid image processing configuration");
	}
	const resize = {
		maxWidth: positiveInteger(value.resize.maxWidth, "maxWidth"),
		maxHeight: positiveInteger(value.resize.maxHeight, "maxHeight"),
		maxInputPixels: positiveInteger(value.resize.maxInputPixels, "maxInputPixels"),
		maxInputEdge: positiveInteger(value.resize.maxInputEdge, "maxInputEdge"),
		maxBytes: positiveInteger(value.resize.maxBytes, "maxBytes"),
		jpegQuality: positiveInteger(value.resize.jpegQuality, "jpegQuality", 100),
	};
	const requestBudget = {
		highWatermarkBytes: positiveInteger(value.requestBudget.highWatermarkBytes, "highWatermarkBytes"),
		lowWatermarkBytes: positiveInteger(value.requestBudget.lowWatermarkBytes, "lowWatermarkBytes"),
	};
	if (requestBudget.lowWatermarkBytes > requestBudget.highWatermarkBytes) {
		throw new RangeError("Image request low watermark must not exceed high watermark");
	}
	return {
		autoResize: value.autoResize,
		blockImages: value.blockImages,
		resize,
		requestBudget,
	};
}

function positiveInteger(value: unknown, field: string, maximum = Number.MAX_SAFE_INTEGER): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
		throw new RangeError(`Invalid image configuration field: ${field}`);
	}
	return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
