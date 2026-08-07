import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import {
	defineCapabilityInputSchema,
	defineCapabilityNoOutputSchema,
	defineCapabilityOutputSchema,
} from "../schema.js";

export const ARTIFACT_LIFETIMES = {
	TEMPORARY: "temporary",
} as const;

const requiredStringType = Type.String({ minLength: 1 });
const artifactRefType = Type.Object(
	{
		id: requiredStringType,
		mimeType: requiredStringType,
		sizeBytes: Type.Integer({ minimum: 0 }),
		lifetime: Type.Literal(ARTIFACT_LIFETIMES.TEMPORARY),
		name: Type.Optional(requiredStringType),
	},
	{ additionalProperties: false },
);
const artifactStorageDestinationType = Type.Object(
	{
		type: Type.Literal("storage-blob"),
		namespace: requiredStringType,
		id: Type.Optional(requiredStringType),
	},
	{ additionalProperties: false },
);
const artifactFilesystemDestinationType = Type.Object(
	{ type: Type.Literal("filesystem"), path: requiredStringType },
	{ additionalProperties: false },
);
const artifactDestinationType = Type.Union([artifactStorageDestinationType, artifactFilesystemDestinationType]);
const artifactPersistInputType = Type.Object(
	{
		ownerId: requiredStringType,
		artifactId: requiredStringType,
		destination: artifactDestinationType,
	},
	{ additionalProperties: false },
);
const artifactReleaseInputType = Type.Object(
	{ ownerId: requiredStringType, artifactId: requiredStringType },
	{ additionalProperties: false },
);
const persistedArtifactType = Type.Union([
	Type.Object(
		{
			type: Type.Literal("storage-blob"),
			id: requiredStringType,
			url: requiredStringType,
			mimeType: requiredStringType,
			sizeBytes: Type.Integer({ minimum: 0 }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("filesystem"),
			path: requiredStringType,
			mimeType: requiredStringType,
			sizeBytes: Type.Integer({ minimum: 0 }),
		},
		{ additionalProperties: false },
	),
]);

export type ArtifactRef = Readonly<Static<typeof artifactRefType>>;
export type ArtifactDestination = Readonly<Static<typeof artifactDestinationType>>;
export type ArtifactPersistInput = Readonly<Static<typeof artifactPersistInputType>>;
export type ArtifactReleaseInput = Readonly<Static<typeof artifactReleaseInputType>>;
export type PersistedArtifact = Readonly<Static<typeof persistedArtifactType>>;

const artifactPersistInputSchema = defineCapabilityInputSchema(artifactPersistInputType, { clean: true });
const artifactReleaseInputSchema = defineCapabilityInputSchema(artifactReleaseInputType, { clean: true });
const persistedArtifactOutputSchema = defineCapabilityOutputSchema(persistedArtifactType, { clean: true });
const noOutputSchema = defineCapabilityNoOutputSchema();

export const FOUNDATION_ARTIFACT_CAPABILITIES = {
	PERSIST: defineCapability<ArtifactPersistInput, PersistedArtifact>({
		id: "cap.foundation.vetta.artifact.persist",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: artifactPersistInputSchema,
		output: persistedArtifactOutputSchema,
	}),
	RELEASE: defineCapability<ArtifactReleaseInput, undefined>({
		id: "cap.foundation.vetta.artifact.release",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: artifactReleaseInputSchema,
		output: noOutputSchema,
	}),
} as const;

export const FOUNDATION_ARTIFACT_CAPABILITY_CATALOG = createCapabilityCatalog(
	Object.values(FOUNDATION_ARTIFACT_CAPABILITIES),
);
