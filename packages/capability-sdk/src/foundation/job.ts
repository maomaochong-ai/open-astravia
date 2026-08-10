import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema } from "../schema.js";
import { CAPABILITY_JSON_MAP_TYPE } from "./json.js";

export const JOB_STATUSES = {
	QUEUED: "queued",
	RUNNING: "running",
	SUCCEEDED: "succeeded",
	FAILED: "failed",
	CANCELLED: "cancelled",
} as const;

export const JOB_ERROR_CODES = {
	CANCEL_UNSUPPORTED: "cancel-unsupported",
	FAILED: "job-failed",
	NOT_FOUND: "job-not-found",
} as const;

const requiredStringType = Type.String({ minLength: 1 });
const jobStatusType = Type.Union(Object.values(JOB_STATUSES).map((status) => Type.Literal(status)));
const jobProgressType = Type.Object(
	{
		value: Type.Number({ minimum: 0, maximum: 1 }),
		phase: Type.Optional(requiredStringType),
	},
	{ additionalProperties: false },
);
const jobArtifactType = Type.Object(
	{
		id: requiredStringType,
		mimeType: requiredStringType,
		sizeBytes: Type.Integer({ minimum: 0 }),
		lifetime: Type.Literal("temporary"),
		name: Type.Optional(requiredStringType),
		// Media jobs attach domain fields on the same artifact refs (see MediaArtifact).
		// Keep them declared so clean/output validation never drops them.
		kind: Type.Optional(Type.Union([Type.Literal("image"), Type.Literal("video"), Type.Literal("audio")])),
		width: Type.Optional(Type.Integer({ minimum: 1 })),
		height: Type.Optional(Type.Integer({ minimum: 1 })),
		durationSeconds: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
	},
	{ additionalProperties: true },
);
const jobFailureType = Type.Object(
	{
		code: requiredStringType,
		message: requiredStringType,
		retryable: Type.Boolean(),
	},
	{ additionalProperties: false },
);
export const JOB_TYPE = Type.Object(
	{
		id: requiredStringType,
		domain: requiredStringType,
		operation: requiredStringType,
		status: jobStatusType,
		progress: Type.Optional(jobProgressType),
		artifacts: Type.Array(jobArtifactType),
		metadata: Type.Optional(CAPABILITY_JSON_MAP_TYPE),
		error: Type.Optional(jobFailureType),
	},
	{ additionalProperties: false },
);
const jobRefType = Type.Object(
	{ ownerId: requiredStringType, id: requiredStringType },
	{ additionalProperties: false },
);

export type JobStatus = Static<typeof jobStatusType>;
export type JobProgress = Readonly<Static<typeof jobProgressType>>;
export type JobFailure = Readonly<Static<typeof jobFailureType>>;
export type Job = Readonly<Static<typeof JOB_TYPE>>;
export type JobRef = Readonly<Static<typeof jobRefType>>;

const jobRefInputSchema = defineCapabilityInputSchema(jobRefType, { clean: true });
const jobOutputSchema = defineCapabilityOutputSchema(JOB_TYPE, { clean: true });

export const FOUNDATION_JOB_CAPABILITIES = {
	GET: defineCapability<JobRef, Job>({
		id: "cap.foundation.vetta.job.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: jobRefInputSchema,
		output: jobOutputSchema,
	}),
	CANCEL: defineCapability<JobRef, Job>({
		id: "cap.foundation.vetta.job.cancel",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: jobRefInputSchema,
		output: jobOutputSchema,
	}),
} as const;

export const FOUNDATION_JOB_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(FOUNDATION_JOB_CAPABILITIES));
