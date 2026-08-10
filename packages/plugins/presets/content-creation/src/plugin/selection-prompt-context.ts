import { Type, type Static, type TProperties } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
	definePluginPromptContext,
	type PluginPromptAttachment,
} from "@vetta-org/plugin-sdk";
import { AssetSchema, WorkflowNodeSchema } from "../project/document-schema";
import { serializeContentProject } from "../project/persistence";
import type { ContentProjectDocument } from "../project/types";

export const CONTENT_SELECTION_PROMPT_ATTACHMENT_ID = "content-creation:node-selection";
const CONTENT_SELECTION_CONTEXT_SCHEMA = "vetta.content-creation.node-selection";
const CONTENT_SELECTION_CONTEXT_VERSION = 1;

function StrictObject<T extends TProperties>(properties: T) {
	return Type.Object(properties, { additionalProperties: false });
}

const SelectionAssetSchema = Type.Omit(AssetSchema, ["source", "createdAt"]);
const SelectionConnectionSchema = StrictObject({
	id: Type.String(),
	fromNodeId: Type.String(),
	toNodeId: Type.String(),
	fromOutput: Type.Optional(Type.String()),
	toInput: Type.Optional(Type.String()),
});

export const ContentSelectionPromptPayloadSchema = StrictObject({
	format: Type.Literal("vetta.content-workflow.selection"),
	schemaVersion: Type.Literal(1),
	project: StrictObject({
		format: Type.Literal("vetta.content-workflow"),
		schemaVersion: Type.Literal(4),
		projectId: Type.String(),
		revision: Type.Number(),
		workflow: StrictObject({
			title: Type.String(),
			objective: Type.String(),
		}),
	}),
	selection: StrictObject({
		primaryNodeId: Type.Optional(Type.String()),
		nodeIds: Type.Array(Type.String()),
		nodes: Type.Array(WorkflowNodeSchema),
		connections: Type.Array(SelectionConnectionSchema),
		assets: Type.Array(SelectionAssetSchema),
	}),
});

export type ContentSelectionPromptPayload = Static<typeof ContentSelectionPromptPayloadSchema>;

export function createContentSelectionPromptAttachment(
	project: ContentProjectDocument,
	selectedNodeIds: readonly string[],
	label: string,
	/** Per-entry labels the input bar renders as `#xxx`. */
	labels: readonly string[],
): PluginPromptAttachment<ContentSelectionPromptPayload> | null {
	const selectedIds = new Set(selectedNodeIds);
	if (selectedIds.size === 0) return null;

	const document = serializeContentProject(project);
	const nodes = document.nodes.filter((node) => selectedIds.has(node.id));
	if (nodes.length === 0) return null;

	const referencedAssetIds = new Set(nodes.flatMap(listReferencedAssetIds));
	const assets = document.assets
		.filter((asset) => referencedAssetIds.has(asset.id))
		.map(({ source: _source, createdAt: _createdAt, ...asset }) => asset);
	const connections = project.graph.edges
		.filter((edge) => selectedIds.has(edge.source) || selectedIds.has(edge.target))
		.map((edge) => ({
			id: edge.id,
			fromNodeId: edge.source,
			toNodeId: edge.target,
			...(edge.sourceHandle ? { fromOutput: edge.sourceHandle } : {}),
			...(edge.targetHandle ? { toInput: edge.targetHandle } : {}),
		}));
	const nodeIds = nodes.map((node) => node.id);
	const payload: ContentSelectionPromptPayload = {
		format: "vetta.content-workflow.selection",
		schemaVersion: 1,
		project: {
			format: document.format,
			schemaVersion: document.schemaVersion,
			projectId: document.projectId,
			revision: document.revision,
			workflow: {
				title: document.workflow.title,
				objective: document.workflow.objective,
			},
		},
		selection: {
			...(nodeIds.length === 1 ? { primaryNodeId: nodeIds[0] } : {}),
			nodeIds,
			nodes,
			connections,
			assets,
		},
	};
	if (!Value.Check(ContentSelectionPromptPayloadSchema, payload)) {
		throw new Error("Invalid content-creation selection prompt context");
	}

	return {
		id: CONTENT_SELECTION_PROMPT_ATTACHMENT_ID,
		label,
		labels: [...labels],
		icon: "icon-[solar--widget-2-linear]",
		lifecycle: "sticky",
		context: definePluginPromptContext({
			schema: CONTENT_SELECTION_CONTEXT_SCHEMA,
			version: CONTENT_SELECTION_CONTEXT_VERSION,
			payload,
		}),
	};
}

export function isCurrentContentSelectionPromptAttachment(
	current: PluginPromptAttachment | null,
	next: PluginPromptAttachment<ContentSelectionPromptPayload>,
): boolean {
	if (current?.id !== next.id || current.label !== next.label) return false;
	if ((current.labels ?? []).join("\u0001") !== (next.labels ?? []).join("\u0001")) return false;
	if (
		current.context?.schema !== CONTENT_SELECTION_CONTEXT_SCHEMA ||
		current.context.version !== CONTENT_SELECTION_CONTEXT_VERSION ||
		!Value.Check(ContentSelectionPromptPayloadSchema, current.context.payload)
	) {
		return false;
	}
	const currentPayload = current.context.payload as ContentSelectionPromptPayload;
	return (
		currentPayload.project.projectId === next.context?.payload.project.projectId &&
		currentPayload.project.revision === next.context.payload.project.revision &&
		currentPayload.selection.nodeIds.length === next.context.payload.selection.nodeIds.length &&
		currentPayload.selection.nodeIds.every(
			(nodeId, index) => nodeId === next.context?.payload.selection.nodeIds[index],
		)
	);
}

function listReferencedAssetIds(node: Static<typeof WorkflowNodeSchema>): string[] {
	const ids: string[] = [];
	if (node.type === "asset") ids.push(...node.assets);
	if ("result" in node && node.result.state === "available") ids.push(node.result.assetId);
	if ("content" in node) {
		for (const segment of node.content.versions.original.segments) {
			if (segment.type === "asset-reference") ids.push(segment.assetId);
		}
	}
	if (node.type === "prompt") {
		for (const input of node.inputs.mediaSources) ids.push(...input.assetIds);
	}
	if (node.type === "image-generator") {
		for (const input of node.inputs.referenceImages) ids.push(...input.assetIds);
	}
	if (node.type === "video-generator") {
		for (const input of [...node.inputs.startImages, ...node.inputs.referenceVideos]) {
			ids.push(...input.assetIds);
		}
	}
	return ids;
}
