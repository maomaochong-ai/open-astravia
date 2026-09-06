import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema } from "../schema.js";

export const OCR_PROTOCOL_VERSION = 1 as const;

export const OCR_ERROR_CODES = {
	INVALID_REQUEST: "invalid-request",
	UNSUPPORTED_INPUT: "unsupported-input",
	INPUT_TOO_LARGE: "input-too-large",
	RATE_LIMITED: "rate-limited",
	UNAUTHORIZED: "unauthorized",
	PROVIDER_UNAVAILABLE: "provider-unavailable",
	PROVIDER_TIMEOUT: "provider-timeout",
	PROVIDER_FAILED: "provider-failed",
	CANCELLED: "cancelled",
} as const;

const requiredString = Type.String({ minLength: 1 });
const ocrErrorCode = Type.Union(Object.values(OCR_ERROR_CODES).map((code) => Type.Literal(code)));
const ocrInputSource = Type.Union([
	Type.Object(
		{ type: Type.Literal("storage-blob"), namespace: requiredString, id: requiredString },
		{ additionalProperties: false },
	),
	Type.Object({ type: Type.Literal("workspace-file"), path: requiredString }, { additionalProperties: false }),
]);
const ocrInput = Type.Object(
	{
		id: Type.Optional(requiredString),
		mimeType: Type.Optional(requiredString),
		source: ocrInputSource,
	},
	{ additionalProperties: false },
);
const providerInput = Type.Object(
	{ id: requiredString, mimeType: Type.Optional(requiredString) },
	{ additionalProperties: false },
);
const ocrBlock = Type.Object(
	{
		id: Type.Optional(requiredString),
		level: Type.Union(
			["page", "block", "paragraph", "line", "word", "symbol", "other"].map((level) => Type.Literal(level)),
		),
		text: requiredString,
		confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
		polygon: Type.Optional(
			Type.Array(
				Type.Object(
					{ x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }) },
					{ additionalProperties: false },
				),
			),
		),
		children: Type.Optional(Type.Array(requiredString)),
		attributes: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]))),
	},
	{ additionalProperties: false },
);
const itemResult = Type.Object(
	{
		id: requiredString,
		status: Type.Union([Type.Literal("ok"), Type.Literal("error"), Type.Literal("cancelled")]),
		text: Type.Optional(Type.String()),
		width: Type.Optional(Type.Integer({ minimum: 1 })),
		height: Type.Optional(Type.Integer({ minimum: 1 })),
		confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
		document: Type.Optional(
			Type.Object(
				{
					pages: Type.Array(
						Type.Object(
							{
								pageNumber: Type.Integer({ minimum: 1 }),
								width: Type.Optional(Type.Integer({ minimum: 1 })),
								height: Type.Optional(Type.Integer({ minimum: 1 })),
								blocks: Type.Array(ocrBlock),
							},
							{ additionalProperties: false },
						),
					),
				},
				{ additionalProperties: false },
			),
		),
		error: Type.Optional(
			Type.Object(
				{
					code: ocrErrorCode,
					message: requiredString,
					retryable: Type.Boolean(),
					providerCode: Type.Optional(requiredString),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
const descriptor = Type.Object(
	{
		id: Type.String({ minLength: 1, maxLength: 129 }),
		displayName: requiredString,
		ownerId: requiredString,
		protocolVersion: Type.Literal(OCR_PROTOCOL_VERSION),
		processing: Type.Union([Type.Literal("local"), Type.Literal("remote")]),
		execution: Type.Union([Type.Literal("sync"), Type.Literal("async"), Type.Literal("both")]),
		status: Type.Union([Type.Literal("ready"), Type.Literal("needs-configuration"), Type.Literal("unavailable")]),
		input: Type.Object(
			{
				kinds: Type.Array(Type.Union([Type.Literal("image"), Type.Literal("document-reference")]), { minItems: 1 }),
				mimeTypes: Type.Array(requiredString, { minItems: 1 }),
				acceptsInlineBytes: Type.Boolean(),
				acceptsUrl: Type.Boolean(),
				maxItemsPerRequest: Type.Optional(Type.Integer({ minimum: 1 })),
				maxBytesPerItem: Type.Optional(Type.Integer({ minimum: 1 })),
				maxPixelsPerImage: Type.Optional(Type.Integer({ minimum: 1 })),
			},
			{ additionalProperties: false },
		),
		output: Type.Object(
			{
				granularities: Type.Array(
					Type.Union(["text", "line", "word", "symbol", "document-tree"].map((level) => Type.Literal(level))),
					{ minItems: 1 },
				),
				supportsConfidence: Type.Boolean(),
				supportsPolygon: Type.Boolean(),
				supportsLanguageDetection: Type.Boolean(),
			},
			{ additionalProperties: false },
		),
		network: Type.Optional(
			Type.Object({ allowedHosts: Type.Array(requiredString) }, { additionalProperties: false }),
		),
		configuration: Type.Optional(
			Type.Object(
				{
					state: Type.Union([
						Type.Literal("ready"),
						Type.Literal("needs-configuration"),
						Type.Literal("unavailable"),
					]),
					settingsViewId: Type.Optional(requiredString),
					reasonCode: Type.Optional(requiredString),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
const request = Type.Object(
	{
		ownerId: requiredString,
		providerId: Type.Optional(Type.String({ minLength: 1, maxLength: 129 })),
		inputs: Type.Array(ocrInput, { minItems: 1 }),
		languages: Type.Optional(Type.Array(requiredString)),
		granularity: Type.Optional(
			Type.Union(["text", "line", "word", "symbol", "document-tree"].map((level) => Type.Literal(level))),
		),
	},
	{ additionalProperties: false },
);
const output = Type.Object(
	{
		protocolVersion: Type.Literal(OCR_PROTOCOL_VERSION),
		providerId: requiredString,
		model: Type.Optional(requiredString),
		items: Type.Array(itemResult, { minItems: 1 }),
	},
	{ additionalProperties: false },
);

export type OcrErrorCode = Static<typeof ocrErrorCode>;
export type OcrInputSource = Readonly<Static<typeof ocrInputSource>>;
export type OcrInput = Readonly<Static<typeof ocrInput>>;
export type OcrProviderInput = Readonly<Static<typeof providerInput>>;
export type OcrBlock = Readonly<Static<typeof ocrBlock>>;
export type OcrItemResult = Readonly<Static<typeof itemResult>>;
export type OcrProviderDescriptor = Readonly<Static<typeof descriptor>>;
export type OcrRequest = Readonly<Static<typeof request>>;
export type OcrResult = Readonly<Static<typeof output>>;

export const DOMAIN_OCR_CAPABILITIES = {
	LIST_PROVIDERS: defineCapability<Record<string, never>, OcrProviderDescriptor[]>({
		id: "cap.domain.vetta.ocr.provider.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: defineCapabilityInputSchema(Type.Object({}, { additionalProperties: false })),
		output: defineCapabilityOutputSchema(Type.Array(descriptor), { clean: true }),
	}),
	RECOGNIZE: defineCapability<OcrRequest, OcrResult>({
		id: "cap.domain.vetta.ocr.recognize",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: defineCapabilityInputSchema(request, { clean: true }),
		output: defineCapabilityOutputSchema(output, { clean: true }),
	}),
} as const;

export const DOMAIN_OCR_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(DOMAIN_OCR_CAPABILITIES));
