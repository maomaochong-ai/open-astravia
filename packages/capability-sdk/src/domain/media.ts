import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema } from "../schema.js";

export const MEDIA_PROTOCOL_VERSION = 2 as const;

export const MEDIA_KINDS = {
	IMAGE: "image",
	VIDEO: "video",
} as const;

export const MEDIA_REFERENCE_KINDS = {
	IMAGE: "image",
	VIDEO: "video",
	AUDIO: "audio",
} as const;

export const MEDIA_GENERATION_MODES = {
	TEXT_TO_IMAGE: "text-to-image",
	IMAGE_TO_IMAGE: "image-to-image",
	TEXT_TO_VIDEO: "text-to-video",
	IMAGE_TO_VIDEO: "image-to-video",
	VIDEO_TO_VIDEO: "video-to-video",
	REFERENCE_TO_VIDEO: "reference-to-video",
} as const;

export const MEDIA_JOB_STATUSES = {
	QUEUED: "queued",
	RUNNING: "running",
	SUCCEEDED: "succeeded",
	FAILED: "failed",
	CANCELLED: "cancelled",
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
const mediaKindType = Type.Union([Type.Literal(MEDIA_KINDS.IMAGE), Type.Literal(MEDIA_KINDS.VIDEO)]);
const mediaReferenceKindType = Type.Union(Object.values(MEDIA_REFERENCE_KINDS).map((kind) => Type.Literal(kind)));
const mediaGenerationModeType = Type.Union(Object.values(MEDIA_GENERATION_MODES).map((mode) => Type.Literal(mode)));
const mediaJobStatusType = Type.Union(Object.values(MEDIA_JOB_STATUSES).map((status) => Type.Literal(status)));
const mediaErrorCodeType = Type.Union(Object.values(MEDIA_ERROR_CODES).map((code) => Type.Literal(code)));
const mediaDimensionsType = Type.Object(
	{ width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }) },
	{ additionalProperties: false },
);
const mediaPluginBlobSourceType = Type.Object(
	{
		type: Type.Literal("plugin-blob"),
		namespace: Type.String({ minLength: 1 }),
		blobId: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);
const mediaWorkspaceFileSourceType = Type.Object(
	{
		type: Type.Literal("workspace-file"),
		path: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);
const mediaReferenceSourceType = Type.Union([mediaPluginBlobSourceType, mediaWorkspaceFileSourceType]);
const mediaReferenceType = Type.Object(
	{
		id: Type.Optional(Type.String({ minLength: 1 })),
		kind: mediaReferenceKindType,
		mimeType: Type.Optional(Type.String({ minLength: 1 })),
		source: mediaReferenceSourceType,
	},
	{ additionalProperties: false },
);
const mediaArtifactType = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		kind: mediaKindType,
		mimeType: Type.String({ minLength: 1 }),
		sizeBytes: Type.Integer({ minimum: 0 }),
		width: Type.Optional(Type.Integer({ minimum: 1 })),
		height: Type.Optional(Type.Integer({ minimum: 1 })),
		durationSeconds: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
	},
	{ additionalProperties: false },
);
const mediaCapabilityType = Type.Object(
	{
		kind: mediaKindType,
		modes: Type.Array(mediaGenerationModeType, { minItems: 1 }),
		aspectRatios: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
		resolutions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
		durationsSeconds: Type.Optional(Type.Array(Type.Number({ exclusiveMinimum: 0 }))),
	},
	{ additionalProperties: false },
);
const mediaProviderDescriptorType = Type.Object(
	{
		id: Type.String({ minLength: 1, maxLength: 129 }),
		ownerId: Type.String({ minLength: 1, maxLength: 128 }),
		protocolVersion: Type.Literal(MEDIA_PROTOCOL_VERSION),
		capabilities: Type.Array(mediaCapabilityType, { minItems: 1 }),
	},
	{ additionalProperties: false },
);
const mediaCreateJobInputType = Type.Object(
	{
		providerId: Type.String({ minLength: 1, maxLength: 129 }),
		kind: mediaKindType,
		mode: mediaGenerationModeType,
		prompt: Type.String({ minLength: 1, maxLength: 64 * 1024 }),
		modelId: Type.Optional(Type.String({ minLength: 1 })),
		dimensions: Type.Optional(mediaDimensionsType),
		aspectRatio: Type.Optional(Type.String({ minLength: 1 })),
		resolution: Type.Optional(Type.String({ minLength: 1 })),
		durationSeconds: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
		references: Type.Optional(Type.Array(mediaReferenceType, { maxItems: 8 })),
	},
	{ additionalProperties: false },
);
const mediaFailureType = Type.Object(
	{
		code: mediaErrorCodeType,
		message: Type.String({ minLength: 1 }),
		retryable: Type.Boolean(),
	},
	{ additionalProperties: false },
);
const mediaJobType = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		providerId: Type.String({ minLength: 1 }),
		status: mediaJobStatusType,
		progress: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
		artifacts: Type.Optional(Type.Array(mediaArtifactType)),
		error: Type.Optional(mediaFailureType),
	},
	{ additionalProperties: false },
);
const mediaJobRefType = Type.Object(
	{ providerId: Type.String({ minLength: 1 }), id: Type.String({ minLength: 1 }) },
	{ additionalProperties: false },
);
const mediaArtifactDestinationType = Type.Union([
	Type.Object(
		{
			type: Type.Literal("plugin-blob"),
			namespace: Type.String({ minLength: 1 }),
			blobId: Type.Optional(Type.String({ minLength: 1 })),
		},
		{ additionalProperties: false },
	),
	mediaWorkspaceFileSourceType,
]);
const mediaArtifactSaveInputType = Type.Object(
	{
		artifactId: Type.String({ minLength: 1 }),
		destination: mediaArtifactDestinationType,
	},
	{ additionalProperties: false },
);
const mediaSavedArtifactType = Type.Union([
	Type.Object(
		{
			type: Type.Literal("plugin-blob"),
			blobId: Type.String({ minLength: 1 }),
			url: Type.String({ minLength: 1 }),
			mimeType: Type.String({ minLength: 1 }),
			sizeBytes: Type.Integer({ minimum: 0 }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("workspace-file"),
			path: Type.String({ minLength: 1 }),
			mimeType: Type.String({ minLength: 1 }),
			sizeBytes: Type.Integer({ minimum: 0 }),
		},
		{ additionalProperties: false },
	),
]);
const mediaArtifactRefType = Type.Object(
	{ artifactId: Type.String({ minLength: 1 }) },
	{ additionalProperties: false },
);

export type MediaKind = Static<typeof mediaKindType>;
export type MediaReferenceKind = Static<typeof mediaReferenceKindType>;
export type MediaGenerationMode = Static<typeof mediaGenerationModeType>;
export type MediaJobStatus = Static<typeof mediaJobStatusType>;
export type MediaErrorCode = Static<typeof mediaErrorCodeType>;
export type MediaDimensions = Readonly<Static<typeof mediaDimensionsType>>;
export type MediaReference = Readonly<Static<typeof mediaReferenceType>>;
export type MediaReferenceSource = Readonly<Static<typeof mediaReferenceSourceType>>;
export type MediaArtifact = Readonly<Static<typeof mediaArtifactType>>;
export type MediaCapability = Readonly<Static<typeof mediaCapabilityType>>;
export type MediaProviderDescriptor = Readonly<Static<typeof mediaProviderDescriptorType>>;
export type MediaCreateJobInput = Readonly<Static<typeof mediaCreateJobInputType>>;
export type MediaFailure = Readonly<Static<typeof mediaFailureType>>;
export type MediaJob = Readonly<Static<typeof mediaJobType>>;
export type MediaJobRef = Readonly<Static<typeof mediaJobRefType>>;
export type MediaArtifactDestination = Readonly<Static<typeof mediaArtifactDestinationType>>;
export type MediaArtifactSaveInput = Readonly<Static<typeof mediaArtifactSaveInputType>>;
export type MediaSavedArtifact = Readonly<Static<typeof mediaSavedArtifactType>>;
export type MediaArtifactRef = Readonly<Static<typeof mediaArtifactRefType>>;
export type MediaProviderCreateJobInput = Omit<MediaCreateJobInput, "providerId" | "references"> & {
	readonly references: readonly MediaReference[];
};
export type MediaProviderJob = Omit<MediaJob, "providerId">;

const mediaEmptyInputSchema = defineCapabilityInputSchema(mediaEmptyInputType);
const mediaProviderListOutputSchema = defineCapabilityOutputSchema(Type.Array(mediaProviderDescriptorType), {
	clean: true,
});
const mediaCreateJobInputSchema = defineCapabilityInputSchema(mediaCreateJobInputType, { clean: true });
const mediaJobRefInputSchema = defineCapabilityInputSchema(mediaJobRefType, { clean: true });
const mediaJobOutputSchema = defineCapabilityOutputSchema(mediaJobType, { clean: true });
const mediaArtifactSaveInputSchema = defineCapabilityInputSchema(mediaArtifactSaveInputType, { clean: true });
const mediaSavedArtifactOutputSchema = defineCapabilityOutputSchema(mediaSavedArtifactType, { clean: true });
const mediaArtifactRefInputSchema = defineCapabilityInputSchema(mediaArtifactRefType, { clean: true });
const mediaEmptyOutputSchema = defineCapabilityOutputSchema(mediaEmptyInputType, { clean: true });

export const DOMAIN_MEDIA_CAPABILITIES = {
	LIST_PROVIDERS: defineCapability<Record<string, never>, MediaProviderDescriptor[]>({
		id: "cap.domain.vetta.media.provider.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 2,
		input: mediaEmptyInputSchema,
		output: mediaProviderListOutputSchema,
	}),
	CREATE_JOB: defineCapability<MediaCreateJobInput, MediaJob>({
		id: "cap.domain.vetta.media.job.create",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 2,
		input: mediaCreateJobInputSchema,
		output: mediaJobOutputSchema,
	}),
	GET_JOB: defineCapability<MediaJobRef, MediaJob>({
		id: "cap.domain.vetta.media.job.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 2,
		input: mediaJobRefInputSchema,
		output: mediaJobOutputSchema,
	}),
	CANCEL_JOB: defineCapability<MediaJobRef, MediaJob>({
		id: "cap.domain.vetta.media.job.cancel",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 2,
		input: mediaJobRefInputSchema,
		output: mediaJobOutputSchema,
	}),
	SAVE_ARTIFACT: defineCapability<MediaArtifactSaveInput, MediaSavedArtifact>({
		id: "cap.domain.vetta.media.artifact.save",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: mediaArtifactSaveInputSchema,
		output: mediaSavedArtifactOutputSchema,
	}),
	RELEASE_ARTIFACT: defineCapability<MediaArtifactRef, Record<string, never>>({
		id: "cap.domain.vetta.media.artifact.release",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: mediaArtifactRefInputSchema,
		output: mediaEmptyOutputSchema,
	}),
} as const;

export const DOMAIN_MEDIA_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(DOMAIN_MEDIA_CAPABILITIES));
