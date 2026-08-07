import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
	CONTENT_CREATION_RUNTIME_SCHEMA_VERSION,
	CONTENT_CREATION_SCHEMA_VERSION,
	type ContentNodeStatus,
	type ContentProjectDocument,
	type ContentProjectRuntimeDocument,
	type GenerationJob,
} from "./types";

const NodeKindSchema = Type.Union([
	Type.Literal("prompt"),
	Type.Literal("image-generator"),
	Type.Literal("video-generator"),
	Type.Literal("asset"),
	Type.Literal("output"),
]);
const NodeStatusSchema = Type.Union([
	Type.Literal("idle"),
	Type.Literal("queued"),
	Type.Literal("running"),
	Type.Literal("succeeded"),
	Type.Literal("failed"),
]);
const AssetKindSchema = Type.Union([Type.Literal("image"), Type.Literal("video"), Type.Literal("audio")]);
const PromptSegmentSchema = Type.Union([
	Type.Object({ type: Type.Literal("text"), text: Type.String() }, { additionalProperties: false }),
	Type.Object(
		{ type: Type.Literal("asset-reference"), bindingId: Type.String() },
		{ additionalProperties: false },
	),
	Type.Object(
		{ type: Type.Literal("prompt-reference"), sourceNodeId: Type.String() },
		{ additionalProperties: false },
	),
]);
const NodeInputBindingSchema = Type.Object(
	{
		id: Type.String(),
		assetId: Type.String(),
		slotId: Type.String(),
		sourceNodeId: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);
const NodeDataSchema = Type.Object(
	{
		prompt: Type.Optional(Type.String()),
		promptDocument: Type.Optional(
			Type.Object(
				{ version: Type.Literal(1), segments: Type.Array(PromptSegmentSchema) },
				{ additionalProperties: false },
			),
		),
		promptOptimization: Type.Optional(
			Type.Object(
				{ text: Type.String(), modelKey: Type.String(), createdAt: Type.String() },
				{ additionalProperties: false },
			),
		),
		assetId: Type.Optional(Type.String()),
		assetIds: Type.Optional(Type.Array(Type.String())),
		aspectRatio: Type.Optional(Type.String()),
		quality: Type.Optional(Type.String()),
		duration: Type.Optional(Type.Number()),
		resolution: Type.Optional(Type.String()),
		providerId: Type.Optional(Type.String()),
		modelId: Type.Optional(Type.String()),
		modeId: Type.Optional(Type.String()),
		promptSourceNodeId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		inputs: Type.Optional(Type.Array(NodeInputBindingSchema)),
	},
	{ additionalProperties: false },
);
const PersistedNodeSchema = Type.Object(
	{
		id: Type.String(),
		kind: NodeKindSchema,
		name: Type.String({ minLength: 1 }),
		position: Type.Object({ x: Type.Number(), y: Type.Number() }, { additionalProperties: false }),
		width: Type.Optional(Type.Number()),
		height: Type.Optional(Type.Number()),
		locked: Type.Optional(Type.Boolean()),
		data: NodeDataSchema,
	},
	{ additionalProperties: false },
);
const EdgeSchema = Type.Object(
	{
		id: Type.String(),
		source: Type.String(),
		target: Type.String(),
		sourceHandle: Type.Optional(Type.String()),
		targetHandle: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);
const AssetSchema = Type.Object(
	{
		id: Type.String(),
		blobId: Type.Optional(Type.String()),
		filePath: Type.Optional(Type.String()),
		kind: AssetKindSchema,
		name: Type.String(),
		mimeType: Type.String(),
		duration: Type.Optional(Type.Number()),
		width: Type.Optional(Type.Number()),
		height: Type.Optional(Type.Number()),
		createdAt: Type.String(),
	},
	{ additionalProperties: false },
);
const TimelineClipSchema = Type.Object(
	{
		id: Type.String(),
		trackId: Type.String(),
		sourceNodeId: Type.Optional(Type.String()),
		assetId: Type.Optional(Type.String()),
		start: Type.Number(),
		duration: Type.Number(),
		sourceIn: Type.Number(),
		speed: Type.Number(),
	},
	{ additionalProperties: false },
);
const TimelineTrackSchema = Type.Object(
	{
		id: Type.String(),
		kind: Type.Union([Type.Literal("video"), Type.Literal("audio")]),
		clips: Type.Array(TimelineClipSchema),
	},
	{ additionalProperties: false },
);
const GenerationJobSchema = Type.Object(
	{
		id: Type.String(),
		nodeId: Type.String(),
		provider: Type.String(),
		model: Type.String(),
		status: Type.Union([
			Type.Literal("queued"),
			Type.Literal("running"),
			Type.Literal("succeeded"),
			Type.Literal("failed"),
			Type.Literal("cancelled"),
		]),
		progress: Type.Number(),
		assetId: Type.Optional(Type.String()),
		error: Type.Optional(Type.String()),
		errorCode: Type.Optional(Type.String()),
		createdAt: Type.String(),
		updatedAt: Type.String(),
	},
	{ additionalProperties: false },
);

export const ContentProjectFileSchema = Type.Object(
	{
		schemaVersion: Type.Literal(CONTENT_CREATION_SCHEMA_VERSION),
		revision: Type.Number(),
		projectId: Type.String({ minLength: 1 }),
		createdAt: Type.String(),
		updatedAt: Type.String(),
		graph: Type.Object(
			{ nodes: Type.Array(PersistedNodeSchema), edges: Type.Array(EdgeSchema) },
			{ additionalProperties: false },
		),
		assets: Type.Array(AssetSchema),
		timeline: Type.Object({ tracks: Type.Array(TimelineTrackSchema) }, { additionalProperties: false }),
	},
	{ additionalProperties: false },
);

export const ContentProjectRuntimeSchema = Type.Object(
	{
		schemaVersion: Type.Literal(CONTENT_CREATION_RUNTIME_SCHEMA_VERSION),
		projectId: Type.String({ minLength: 1 }),
		updatedAt: Type.String(),
		jobs: Type.Array(GenerationJobSchema),
		nodeStatuses: Type.Record(Type.String(), NodeStatusSchema),
	},
	{ additionalProperties: false },
);

export type ContentProjectFile = Static<typeof ContentProjectFileSchema>;

export function isContentProjectFile(value: unknown): value is ContentProjectFile {
	return Value.Check(ContentProjectFileSchema, value) && value.assets.every((asset) => asset.blobId || asset.filePath);
}

export function isContentProjectRuntime(value: unknown): value is ContentProjectRuntimeDocument {
	return Value.Check(ContentProjectRuntimeSchema, value);
}

export function isGenerationJob(value: unknown): value is GenerationJob {
	return Value.Check(GenerationJobSchema, value);
}

export function serializeContentProject(project: ContentProjectDocument): ContentProjectFile {
	return {
		schemaVersion: CONTENT_CREATION_SCHEMA_VERSION,
		revision: project.revision,
		projectId: project.projectId,
		createdAt: project.createdAt,
		updatedAt: project.updatedAt,
		graph: {
			nodes: project.graph.nodes.map(({ status: _status, ...node }) => ({
				...node,
				name: node.name?.trim() || node.kind,
			})),
			edges: structuredClone(project.graph.edges),
		},
		assets: project.assets.map(({ previewUrl: _previewUrl, ...asset }) => asset),
		timeline: structuredClone(project.timeline),
	};
}

export function serializeContentProjectRuntime(project: ContentProjectDocument): ContentProjectRuntimeDocument {
	return {
		schemaVersion: CONTENT_CREATION_RUNTIME_SCHEMA_VERSION,
		projectId: project.projectId,
		updatedAt: project.updatedAt,
		jobs: structuredClone(project.jobs),
		nodeStatuses: Object.fromEntries(project.graph.nodes.map((node) => [node.id, node.status])) as Record<
			string,
			ContentNodeStatus
		>,
	};
}
