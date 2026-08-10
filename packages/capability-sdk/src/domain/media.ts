import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { JOB_TYPE, type Job } from "../foundation/job.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema } from "../schema.js";

export const MEDIA_PROTOCOL_VERSION = 4 as const;

export const MEDIA_OPERATIONS = {
	GENERATE: "generate",
	COMPOSE: "compose",
	TRANSCODE: "transcode",
} as const;

export const MEDIA_KINDS = {
	IMAGE: "image",
	VIDEO: "video",
	AUDIO: "audio",
} as const;

export const MEDIA_INPUT_KINDS = {
	IMAGE: "image",
	VIDEO: "video",
	AUDIO: "audio",
	DOCUMENT: "document",
} as const;

export const MEDIA_GENERATION_MODES = {
	TEXT_TO_IMAGE: "text-to-image",
	IMAGE_TO_IMAGE: "image-to-image",
	TEXT_TO_VIDEO: "text-to-video",
	IMAGE_TO_VIDEO: "image-to-video",
	VIDEO_TO_VIDEO: "video-to-video",
	REFERENCE_TO_VIDEO: "reference-to-video",
} as const;

export const MEDIA_ERROR_CODES = {
	UNAUTHENTICATED: "unauthenticated",
	PROVIDER_UNAVAILABLE: "provider-unavailable",
	OPERATION_UNSUPPORTED: "operation-unsupported",
	INVALID_REQUEST: "invalid-request",
	NOT_ENTITLED: "not-entitled",
	QUOTA_EXHAUSTED: "quota-exhausted",
	CONTENT_REJECTED: "content-rejected",
	PROVIDER_TIMEOUT: "provider-timeout",
	PROVIDER_FAILED: "provider-failed",
	CANCELLED: "cancelled",
} as const;

const mediaEmptyInputType = Type.Object({}, { additionalProperties: false });
const requiredStringType = Type.String({ minLength: 1 });
const mediaKindType = Type.Union(Object.values(MEDIA_KINDS).map((kind) => Type.Literal(kind)));
const mediaGenerationKindType = Type.Union([Type.Literal(MEDIA_KINDS.IMAGE), Type.Literal(MEDIA_KINDS.VIDEO)]);
const mediaInputKindType = Type.Union(Object.values(MEDIA_INPUT_KINDS).map((kind) => Type.Literal(kind)));
const mediaGenerationModeType = Type.Union(Object.values(MEDIA_GENERATION_MODES).map((mode) => Type.Literal(mode)));
const mediaErrorCodeType = Type.Union(Object.values(MEDIA_ERROR_CODES).map((code) => Type.Literal(code)));
const mediaDimensionsType = Type.Object(
	{ width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }) },
	{ additionalProperties: false },
);
const mediaPluginBlobSourceType = Type.Object(
	{
		type: Type.Literal("plugin-blob"),
		namespace: requiredStringType,
		blobId: requiredStringType,
	},
	{ additionalProperties: false },
);
const mediaWorkspaceFileSourceType = Type.Object(
	{ type: Type.Literal("workspace-file"), path: requiredStringType },
	{ additionalProperties: false },
);
const mediaInputSourceType = Type.Union([mediaPluginBlobSourceType, mediaWorkspaceFileSourceType]);
const mediaInputType = Type.Object(
	{
		id: Type.Optional(requiredStringType),
		role: Type.Optional(requiredStringType),
		kind: mediaInputKindType,
		mimeType: Type.Optional(requiredStringType),
		source: mediaInputSourceType,
	},
	{ additionalProperties: false },
);
const mediaProviderInputType = Type.Object(
	{
		id: requiredStringType,
		role: Type.Optional(requiredStringType),
		kind: mediaInputKindType,
		mimeType: Type.Optional(requiredStringType),
	},
	{ additionalProperties: false },
);
const mediaOutputType = Type.Object(
	{
		kind: mediaKindType,
		mimeType: requiredStringType,
		dimensions: Type.Optional(mediaDimensionsType),
		fps: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
		durationSeconds: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
		videoCodec: Type.Optional(requiredStringType),
		audioCodec: Type.Optional(requiredStringType),
	},
	{ additionalProperties: false },
);
const mediaArtifactType = Type.Object(
	{
		id: requiredStringType,
		kind: mediaKindType,
		mimeType: requiredStringType,
		sizeBytes: Type.Integer({ minimum: 0 }),
		lifetime: Type.Literal("temporary"),
		name: Type.Optional(requiredStringType),
		width: Type.Optional(Type.Integer({ minimum: 1 })),
		height: Type.Optional(Type.Integer({ minimum: 1 })),
		durationSeconds: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
	},
	{ additionalProperties: false },
);
const mediaGenerationInputSlotType = Type.Object(
	{
		role: requiredStringType,
		kinds: Type.Array(mediaInputKindType, { minItems: 1 }),
		minItems: Type.Integer({ minimum: 0 }),
		maxItems: Type.Integer({ minimum: 1 }),
	},
	{ additionalProperties: false },
);
const mediaGenerationModeCapabilityType = Type.Object(
	{
		mode: mediaGenerationModeType,
		inputs: Type.Array(mediaGenerationInputSlotType),
		minTotalItems: Type.Optional(Type.Integer({ minimum: 0 })),
		maxTotalItems: Type.Optional(Type.Integer({ minimum: 1 })),
		aspectRatioPolicy: Type.Optional(Type.Union([Type.Literal("configurable"), Type.Literal("input-derived")])),
		audioGeneration: Type.Optional(
			Type.Union([Type.Literal("none"), Type.Literal("always"), Type.Literal("optional")]),
		),
	},
	{ additionalProperties: false },
);
const mediaGenerateCapabilityType = Type.Object(
	{
		operation: Type.Literal(MEDIA_OPERATIONS.GENERATE),
		kind: mediaGenerationKindType,
		modes: Type.Array(mediaGenerationModeType, { minItems: 1 }),
		aspectRatios: Type.Optional(Type.Array(requiredStringType)),
		resolutions: Type.Optional(Type.Array(requiredStringType)),
		durationsSeconds: Type.Optional(Type.Array(Type.Number({ exclusiveMinimum: 0 }))),
		modeCapabilities: Type.Optional(Type.Array(mediaGenerationModeCapabilityType)),
	},
	{ additionalProperties: false },
);
const mediaComposeCapabilityType = Type.Object(
	{
		operation: Type.Literal(MEDIA_OPERATIONS.COMPOSE),
		documentMimeTypes: Type.Array(requiredStringType, { minItems: 1 }),
		outputMimeTypes: Type.Array(requiredStringType, { minItems: 1 }),
	},
	{ additionalProperties: false },
);
const mediaTranscodeCapabilityType = Type.Object(
	{
		operation: Type.Literal(MEDIA_OPERATIONS.TRANSCODE),
		inputMimeTypes: Type.Array(requiredStringType, { minItems: 1 }),
		outputMimeTypes: Type.Array(requiredStringType, { minItems: 1 }),
	},
	{ additionalProperties: false },
);
const mediaProviderCapabilityType = Type.Union([
	mediaGenerateCapabilityType,
	mediaComposeCapabilityType,
	mediaTranscodeCapabilityType,
]);
const mediaProviderDescriptorType = Type.Object(
	{
		id: Type.String({ minLength: 1, maxLength: 129 }),
		displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
		ownerId: Type.String({ minLength: 1, maxLength: 128 }),
		protocolVersion: Type.Literal(MEDIA_PROTOCOL_VERSION),
		capabilities: Type.Array(mediaProviderCapabilityType, { minItems: 1 }),
	},
	{ additionalProperties: false },
);

const mediaSubmitBaseProperties = {
	ownerId: requiredStringType,
	providerId: Type.String({ minLength: 1, maxLength: 129 }),
	inputs: Type.Array(mediaInputType),
};
const mediaGenerateInputType = Type.Object(
	{
		...mediaSubmitBaseProperties,
		operation: Type.Literal(MEDIA_OPERATIONS.GENERATE),
		kind: mediaGenerationKindType,
		mode: mediaGenerationModeType,
		prompt: Type.String({ minLength: 1, maxLength: 64 * 1024 }),
		modelId: Type.Optional(requiredStringType),
		dimensions: Type.Optional(mediaDimensionsType),
		aspectRatio: Type.Optional(requiredStringType),
		resolution: Type.Optional(requiredStringType),
		durationSeconds: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
	},
	{ additionalProperties: false },
);
const mediaComposeInputType = Type.Object(
	{
		...mediaSubmitBaseProperties,
		operation: Type.Literal(MEDIA_OPERATIONS.COMPOSE),
		output: mediaOutputType,
	},
	{ additionalProperties: false },
);
const mediaTranscodeInputType = Type.Object(
	{
		...mediaSubmitBaseProperties,
		operation: Type.Literal(MEDIA_OPERATIONS.TRANSCODE),
		output: mediaOutputType,
	},
	{ additionalProperties: false },
);
const mediaSubmitInputType = Type.Union([mediaGenerateInputType, mediaComposeInputType, mediaTranscodeInputType]);
const mediaFailureType = Type.Object(
	{
		code: mediaErrorCodeType,
		message: requiredStringType,
		retryable: Type.Boolean(),
	},
	{ additionalProperties: false },
);
const mediaProviderJobType = Type.Object(
	{
		id: requiredStringType,
		status: Type.Union([
			Type.Literal("queued"),
			Type.Literal("running"),
			Type.Literal("succeeded"),
			Type.Literal("failed"),
			Type.Literal("cancelled"),
		]),
		progress: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
		artifacts: Type.Optional(Type.Array(mediaArtifactType)),
		error: Type.Optional(mediaFailureType),
	},
	{ additionalProperties: false },
);

export type MediaOperation = Static<typeof mediaSubmitInputType>["operation"];
export type MediaKind = Static<typeof mediaKindType>;
export type MediaInputKind = Static<typeof mediaInputKindType>;
export type MediaGenerationMode = Static<typeof mediaGenerationModeType>;
export type MediaErrorCode = Static<typeof mediaErrorCodeType>;
export type MediaDimensions = Readonly<Static<typeof mediaDimensionsType>>;
export type MediaInputSource = Readonly<Static<typeof mediaInputSourceType>>;
export type MediaInput = Readonly<Static<typeof mediaInputType>>;
export type MediaProviderInput = Readonly<Static<typeof mediaProviderInputType>>;
export type MediaOutput = Readonly<Static<typeof mediaOutputType>>;
export type MediaArtifact = Readonly<Static<typeof mediaArtifactType>>;
export type MediaGenerationInputSlot = Readonly<Static<typeof mediaGenerationInputSlotType>>;
export type MediaGenerationModeCapability = Readonly<Static<typeof mediaGenerationModeCapabilityType>>;
export type MediaProviderCapability = Readonly<Static<typeof mediaProviderCapabilityType>>;
export type MediaProviderDescriptor = Readonly<Static<typeof mediaProviderDescriptorType>>;
export type MediaSubmitInput = Readonly<Static<typeof mediaSubmitInputType>>;
export type MediaGenerateInput = Readonly<Static<typeof mediaGenerateInputType>>;
export type MediaComposeInput = Readonly<Static<typeof mediaComposeInputType>>;
export type MediaTranscodeInput = Readonly<Static<typeof mediaTranscodeInputType>>;
export type MediaFailure = Readonly<Static<typeof mediaFailureType>>;
export type MediaProviderJob = Readonly<Static<typeof mediaProviderJobType>>;
type ToMediaProviderInput<Input> = Input extends MediaSubmitInput
	? Omit<Input, "ownerId" | "providerId" | "inputs"> & { readonly inputs: readonly MediaProviderInput[] }
	: never;
export type MediaProviderSubmitInput = ToMediaProviderInput<MediaSubmitInput>;
const mediaEmptyInputSchema = defineCapabilityInputSchema(mediaEmptyInputType);
const mediaProviderListOutputSchema = defineCapabilityOutputSchema(Type.Array(mediaProviderDescriptorType), {
	clean: true,
});
const mediaSubmitInputSchema = defineCapabilityInputSchema(mediaSubmitInputType, { clean: true });
const mediaJobOutputSchema = defineCapabilityOutputSchema(JOB_TYPE, { clean: true });

export const DOMAIN_MEDIA_CAPABILITIES = {
	LIST_PROVIDERS: defineCapability<Record<string, never>, MediaProviderDescriptor[]>({
		id: "cap.domain.vetta.media.provider.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 3,
		input: mediaEmptyInputSchema,
		output: mediaProviderListOutputSchema,
	}),
	SUBMIT: defineCapability<MediaSubmitInput, Job>({
		id: "cap.domain.vetta.media.job.submit",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: mediaSubmitInputSchema,
		output: mediaJobOutputSchema,
	}),
} as const;

export const DOMAIN_MEDIA_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(DOMAIN_MEDIA_CAPABILITIES));
