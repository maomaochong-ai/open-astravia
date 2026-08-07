import { Type, type Static, type TProperties } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { CONTENT_CREATION_FORMAT, CONTENT_CREATION_SCHEMA_VERSION } from "./types";

function StrictObject<T extends TProperties>(properties: T) {
	return Type.Object(properties, { additionalProperties: false });
}

const PromptSegmentSchema = Type.Union([
	StrictObject({ type: Type.Literal("text"), value: Type.String() }),
	StrictObject({
		type: Type.Literal("asset-reference"),
		assetId: Type.String(),
		role: Type.String(),
	}),
	StrictObject({
		type: Type.Literal("node-output-reference"),
		nodeId: Type.String(),
		output: Type.Literal("prompt"),
	}),
]);

const PromptContentSchema = StrictObject({
	versions: StrictObject({
		original: StrictObject({ segments: Type.Array(PromptSegmentSchema) }),
		optimized: Type.Optional(
			StrictObject({
				text: Type.String(),
				model: Type.String(),
				createdAt: Type.String(),
			}),
		),
	}),
	activeVersion: Type.Union([Type.Literal("original"), Type.Literal("optimized")]),
});

const NodeOutputSourceSchema = StrictObject({
	fromNode: Type.String(),
	output: Type.Union([
		Type.Literal("prompt"),
		Type.Literal("image"),
		Type.Literal("video"),
		Type.Literal("media-collection"),
		Type.Literal("deliverable"),
	]),
});

const MediaInputSchema = StrictObject({
	fromNode: Type.Optional(Type.String()),
	output: Type.Optional(
		Type.Union([Type.Literal("image"), Type.Literal("video"), Type.Literal("media-collection")]),
	),
	assetIds: Type.Array(Type.String()),
	role: Type.String(),
});

const GenerationModelSchema = Type.Union([
	StrictObject({ selection: Type.Literal("automatic") }),
	StrictObject({
		selection: Type.Literal("specific"),
		providerId: Type.String(),
		modelId: Type.String(),
		modeId: Type.Optional(Type.String()),
	}),
]);

const GenerationResultSchema = Type.Union([
	StrictObject({ state: Type.Literal("not-generated") }),
	StrictObject({ state: Type.Literal("available"), assetId: Type.String() }),
]);

const NodeCommon = {
	id: Type.String(),
	name: Type.String(),
	purpose: Type.String(),
};

const WorkflowNodeSchema = Type.Union([
	StrictObject({
		...NodeCommon,
		type: Type.Literal("prompt"),
		content: PromptContentSchema,
		inputs: StrictObject({ mediaSources: Type.Array(MediaInputSchema) }),
		produces: StrictObject({ type: Type.Literal("prompt") }),
	}),
	StrictObject({
		...NodeCommon,
		type: Type.Literal("image-generator"),
		content: PromptContentSchema,
		inputs: StrictObject({
			promptSources: Type.Array(NodeOutputSourceSchema),
			referenceImages: Type.Array(MediaInputSchema),
		}),
		generation: StrictObject({
			model: GenerationModelSchema,
			aspectRatio: Type.Optional(Type.String()),
			quality: Type.Optional(Type.String()),
		}),
		produces: StrictObject({ type: Type.Literal("image") }),
		result: GenerationResultSchema,
	}),
	StrictObject({
		...NodeCommon,
		type: Type.Literal("video-generator"),
		content: PromptContentSchema,
		inputs: StrictObject({
			promptSources: Type.Array(NodeOutputSourceSchema),
			startImages: Type.Array(MediaInputSchema),
			referenceVideos: Type.Array(MediaInputSchema),
		}),
		generation: StrictObject({
			model: GenerationModelSchema,
			aspectRatio: Type.Optional(Type.String()),
			durationSeconds: Type.Optional(Type.Number()),
			resolution: Type.Optional(Type.String()),
		}),
		produces: StrictObject({ type: Type.Literal("video") }),
		result: GenerationResultSchema,
	}),
	StrictObject({
		...NodeCommon,
		type: Type.Literal("asset"),
		assets: Type.Array(Type.String()),
		produces: StrictObject({ type: Type.Literal("media-collection") }),
	}),
	StrictObject({
		...NodeCommon,
		type: Type.Literal("output"),
		inputs: StrictObject({ contentSources: Type.Array(NodeOutputSourceSchema) }),
		produces: StrictObject({ type: Type.Literal("deliverable") }),
		result: GenerationResultSchema,
	}),
]);

const AssetSchema = StrictObject({
	id: Type.String(),
	name: Type.String(),
	type: Type.Union([Type.Literal("image"), Type.Literal("video"), Type.Literal("audio")]),
	source: Type.Union([
		StrictObject({ storage: Type.Literal("managed"), blobId: Type.String() }),
		StrictObject({ storage: Type.Literal("workspace"), path: Type.String() }),
	]),
	origin: Type.Union([
		StrictObject({ type: Type.Literal("user-imported") }),
		StrictObject({ type: Type.Literal("generated"), byNode: Type.String() }),
	]),
	metadata: StrictObject({
		mimeType: Type.String(),
		width: Type.Optional(Type.Number()),
		height: Type.Optional(Type.Number()),
		durationSeconds: Type.Optional(Type.Number()),
	}),
	createdAt: Type.String(),
});

const TimelineClipSchema = StrictObject({
	id: Type.String(),
	trackId: Type.String(),
	sourceNodeId: Type.Optional(Type.String()),
	assetId: Type.Optional(Type.String()),
	start: Type.Number(),
	duration: Type.Number(),
	sourceIn: Type.Number(),
	speed: Type.Number(),
});

const TimelineTrackSchema = StrictObject({
	id: Type.String(),
	kind: Type.Union([Type.Literal("video"), Type.Literal("audio")]),
	clips: Type.Array(TimelineClipSchema),
});

export const ContentProjectFileSchema = StrictObject({
	format: Type.Literal(CONTENT_CREATION_FORMAT),
	schemaVersion: Type.Literal(CONTENT_CREATION_SCHEMA_VERSION),
	revision: Type.Number(),
	projectId: Type.String(),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	workflow: StrictObject({
		title: Type.String(),
		objective: Type.String(),
		deliverables: Type.Array(
			StrictObject({
				type: Type.Union([
					Type.Literal("image"),
					Type.Literal("video"),
					Type.Literal("audio"),
					Type.Literal("text"),
					Type.Literal("content"),
				]),
				fromNode: Type.String(),
				description: Type.String(),
			}),
		),
	}),
	nodes: Type.Array(WorkflowNodeSchema),
	assets: Type.Array(AssetSchema),
	view: StrictObject({
		nodes: Type.Record(
			Type.String(),
			StrictObject({
				x: Type.Number(),
				y: Type.Number(),
				width: Type.Optional(Type.Number()),
				height: Type.Optional(Type.Number()),
				locked: Type.Optional(Type.Boolean()),
			}),
		),
	}),
	timeline: StrictObject({ tracks: Type.Array(TimelineTrackSchema) }),
});

export type ContentProjectFile = Static<typeof ContentProjectFileSchema>;
export type WorkflowNode = Static<typeof WorkflowNodeSchema>;
export type PromptContent = Static<typeof PromptContentSchema>;
export type PromptSegment = Static<typeof PromptSegmentSchema>;
export type NodeOutputSource = Static<typeof NodeOutputSourceSchema>;
export type MediaInput = Static<typeof MediaInputSchema>;
export type GenerationModel = Static<typeof GenerationModelSchema>;

export function isContentProjectFile(value: unknown): value is ContentProjectFile {
	if (!Value.Check(ContentProjectFileSchema, value)) return false;
	const document = value as ContentProjectFile;
	const nodeIds = new Set(document.nodes.map((node) => node.id));
	const assetIds = new Set(document.assets.map((asset) => asset.id));
	const producedByNode = new Map(document.nodes.map((node) => [node.id, node.produces.type]));
	const assetKindById = new Map(document.assets.map((asset) => [asset.id, asset.type]));
	if (nodeIds.size !== document.nodes.length || assetIds.size !== document.assets.length) return false;
	if (document.nodes.some((node) => !document.view.nodes[node.id])) return false;
	if (document.workflow.deliverables.some((deliverable) => !nodeIds.has(deliverable.fromNode))) return false;
	if (
		document.assets.some(
			(asset) => asset.origin.type === "generated" && !nodeIds.has(asset.origin.byNode),
		)
	) {
		return false;
	}
	return document.nodes.every((node) =>
		validateNodeReferences(node, nodeIds, assetIds, producedByNode, assetKindById),
	);
}

function validateNodeReferences(
	node: WorkflowNode,
	nodeIds: ReadonlySet<string>,
	assetIds: ReadonlySet<string>,
	producedByNode: ReadonlyMap<string, WorkflowNode["produces"]["type"]>,
	assetKindById: ReadonlyMap<string, ContentProjectFile["assets"][number]["type"]>,
): boolean {
	if ("result" in node && node.result.state === "available" && !assetIds.has(node.result.assetId)) {
		return false;
	}
	if (
		"result" in node &&
		node.result.state === "available" &&
		((node.type === "image-generator" && assetKindById.get(node.result.assetId) !== "image") ||
			(node.type === "video-generator" && assetKindById.get(node.result.assetId) !== "video"))
	) {
		return false;
	}
	if (node.type === "asset") return node.assets.every((assetId) => assetIds.has(assetId));
	const nodeSources =
		node.type === "image-generator" || node.type === "video-generator"
			? node.inputs.promptSources
			: node.type === "output"
				? node.inputs.contentSources
				: [];
	if (
		nodeSources.some(
			(source) =>
				!nodeIds.has(source.fromNode) || producedByNode.get(source.fromNode) !== source.output,
		)
	) {
		return false;
	}
	if (node.type === "output") return true;
	const mediaInputs =
		node.type === "prompt"
			? node.inputs.mediaSources
			: node.type === "image-generator"
				? node.inputs.referenceImages
				: [...node.inputs.startImages, ...node.inputs.referenceVideos];
	if (
		mediaInputs.some(
			(input) =>
				(input.fromNode === undefined) !== (input.output === undefined) ||
				(input.fromNode !== undefined &&
					(!nodeIds.has(input.fromNode) || producedByNode.get(input.fromNode) !== input.output)) ||
				input.assetIds.some((assetId) => !assetIds.has(assetId)),
		)
	) {
		return false;
	}
	if (node.content.activeVersion === "optimized" && !node.content.versions.optimized) return false;
	return node.content.versions.original.segments.every((segment) => {
		if (segment.type === "asset-reference") return assetIds.has(segment.assetId);
		if (segment.type === "node-output-reference") {
			return nodeIds.has(segment.nodeId) && producedByNode.get(segment.nodeId) === segment.output;
		}
		return true;
	});
}
