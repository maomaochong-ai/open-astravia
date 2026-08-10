import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
	CONTENT_CREATION_RUNTIME_SCHEMA_VERSION,
	type ContentNodeStatus,
	type ContentProjectDocument,
	type ContentProjectRuntimeDocument,
	type GenerationJob,
} from "./types";

const NodeStatusSchema = Type.Union([
	Type.Literal("idle"),
	Type.Literal("queued"),
	Type.Literal("running"),
	Type.Literal("succeeded"),
	Type.Literal("failed"),
]);

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
		outputAssetId: Type.Optional(Type.String()),
		execution: Type.Optional(
			Type.Object(
				{
					kind: Type.Literal("host-job"),
					jobId: Type.String({ minLength: 1 }),
					outputKind: Type.Union([Type.Literal("image"), Type.Literal("video")]),
				},
				{ additionalProperties: false },
			),
		),
		assetId: Type.Optional(Type.String()),
		error: Type.Optional(Type.String()),
		errorCode: Type.Optional(Type.String()),
		createdAt: Type.String(),
		updatedAt: Type.String(),
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

export {
	ContentProjectFileSchema,
	isContentProjectFile,
	type ContentProjectFile,
} from "./document-schema";
export { hydrateContentProject } from "./hydrate-project";
export { serializeContentProject } from "./serialize-project";

export function isContentProjectRuntime(value: unknown): value is ContentProjectRuntimeDocument {
	return Value.Check(ContentProjectRuntimeSchema, value);
}

export function isGenerationJob(value: unknown): value is GenerationJob {
	return Value.Check(GenerationJobSchema, value);
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
