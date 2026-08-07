import { createContentPromptDocument } from "../node/prompt-document";
import type {
	AssetKind,
	ContentEdge,
	ContentNode,
	ContentNodeInputBinding,
	ContentProjectDocument,
} from "./types";
import { CONTENT_CREATION_FORMAT, CONTENT_CREATION_SCHEMA_VERSION } from "./types";
import type {
	ContentProjectFile,
	MediaInput,
	NodeOutputSource,
	PromptContent,
	PromptSegment,
	WorkflowNode,
} from "./document-schema";
import { getDefaultNodePurpose } from "./node-semantics";

export function serializeContentProject(project: ContentProjectDocument): ContentProjectFile {
	const nodesById = new Map(project.graph.nodes.map((node) => [node.id, node]));
	const assetKinds = new Map(project.assets.map((asset) => [asset.id, asset.kind]));
	const generatedByNode = new Map(
		project.graph.nodes.flatMap((node) => (node.data.assetId ? [[node.data.assetId, node.id] as const] : [])),
	);
	return {
		format: CONTENT_CREATION_FORMAT,
		schemaVersion: CONTENT_CREATION_SCHEMA_VERSION,
		revision: project.revision,
		projectId: project.projectId,
		createdAt: project.createdAt,
		updatedAt: project.updatedAt,
		workflow: structuredClone(project.workflow),
		nodes: project.graph.nodes.map((node) =>
			serializeNode(node, project.graph.edges, nodesById, assetKinds),
		),
		assets: project.assets.map((asset) => {
			const generatedBy = generatedByNode.get(asset.id);
			return {
				id: asset.id,
				name: asset.name,
				type: asset.kind,
				source: asset.filePath
					? { storage: "workspace" as const, path: asset.filePath }
					: { storage: "managed" as const, blobId: asset.blobId ?? asset.id },
				origin: generatedBy
					? { type: "generated" as const, byNode: generatedBy }
					: { type: "user-imported" as const },
				metadata: {
					mimeType: asset.mimeType,
					...(asset.width === undefined ? {} : { width: asset.width }),
					...(asset.height === undefined ? {} : { height: asset.height }),
					...(asset.duration === undefined ? {} : { durationSeconds: asset.duration }),
				},
				createdAt: asset.createdAt,
			};
		}),
		view: {
			nodes: Object.fromEntries(
				project.graph.nodes.map((node) => [
					node.id,
					{
						x: node.position.x,
						y: node.position.y,
						...(node.width === undefined ? {} : { width: node.width }),
						...(node.height === undefined ? {} : { height: node.height }),
						...(node.locked === undefined ? {} : { locked: node.locked }),
					},
				]),
			),
		},
		timeline: structuredClone(project.timeline),
	};
}

function serializeNode(
	node: ContentNode,
	edges: readonly ContentEdge[],
	nodesById: ReadonlyMap<string, ContentNode>,
	assetKinds: ReadonlyMap<string, AssetKind>,
): WorkflowNode {
	const common = {
		id: node.id,
		name: node.name?.trim() || node.kind,
		purpose: node.purpose?.trim() || getDefaultNodePurpose(node.kind),
	};
	if (node.kind === "prompt") {
		return {
			...common,
			type: "prompt",
			content: serializePromptContent(node),
			inputs: {
				mediaSources: serializeMediaInputs(node, edges, nodesById, assetKinds, "media", "reference"),
			},
			produces: { type: "prompt" },
		};
	}
	if (node.kind === "image-generator") {
		const promptSources = serializeNodeSources(node.id, "prompt", edges, nodesById);
		return {
			...common,
			type: "image-generator",
			content: serializePromptContent(node, promptSources[0]),
			inputs: {
				promptSources,
				referenceImages: serializeMediaInputs(
					node,
					edges,
					nodesById,
					assetKinds,
					"reference",
					"reference-image",
					"image",
				),
			},
			generation: {
				model: serializeGenerationModel(node),
				...(node.data.aspectRatio ? { aspectRatio: node.data.aspectRatio } : {}),
				...(node.data.quality ? { quality: node.data.quality } : {}),
			},
			produces: { type: "image" },
			result: serializeResult(node.data.assetId),
		};
	}
	if (node.kind === "video-generator") {
		const promptSources = serializeNodeSources(node.id, "prompt", edges, nodesById);
		return {
			...common,
			type: "video-generator",
			content: serializePromptContent(node, promptSources[0]),
			inputs: {
				promptSources,
				startImages: serializeMediaInputs(
					node,
					edges,
					nodesById,
					assetKinds,
					"image",
					"start-image",
					"image",
				),
				referenceVideos: serializeMediaInputs(
					node,
					edges,
					nodesById,
					assetKinds,
					"video",
					"reference-video",
					"video",
				),
			},
			generation: {
				model: serializeGenerationModel(node),
				...(node.data.aspectRatio ? { aspectRatio: node.data.aspectRatio } : {}),
				...(node.data.duration === undefined ? {} : { durationSeconds: node.data.duration }),
				...(node.data.resolution ? { resolution: node.data.resolution } : {}),
			},
			produces: { type: "video" },
			result: serializeResult(node.data.assetId),
		};
	}
	if (node.kind === "asset") {
		return {
			...common,
			type: "asset",
			assets: [...(node.data.assetIds ?? [])],
			produces: { type: "media-collection" },
		};
	}
	return {
		...common,
		type: "output",
		inputs: { contentSources: serializeNodeSources(node.id, "content", edges, nodesById) },
		produces: { type: "deliverable" },
		result: serializeResult(node.data.assetId),
	};
}

function serializePromptContent(node: ContentNode, fallbackPromptSource?: NodeOutputSource): PromptContent {
	const bindings = new Map((node.data.inputs ?? []).map((binding) => [binding.id, binding]));
	const document = createContentPromptDocument(node.data);
	const segments = document.segments.flatMap((segment): PromptSegment[] => {
		if (segment.type === "text") return [{ type: "text", value: segment.text }];
		if (segment.type === "prompt-reference") {
			return [{ type: "node-output-reference", nodeId: segment.sourceNodeId, output: "prompt" }];
		}
		const binding = bindings.get(segment.bindingId);
		return binding
			? [{ type: "asset-reference", assetId: binding.assetId, role: binding.slotId }]
			: [];
	});
	const usesImplicitLegacyPrompt =
		!node.data.promptDocument &&
		node.data.promptSourceNodeId === undefined &&
		!node.data.prompt?.trim();
	if ((segments.length === 0 || usesImplicitLegacyPrompt) && fallbackPromptSource?.output === "prompt") {
		segments.unshift({
			type: "node-output-reference",
			nodeId: fallbackPromptSource.fromNode,
			output: "prompt",
		});
	}
	return {
		versions: {
			original: { segments },
			...(node.data.promptOptimization
				? {
					optimized: {
						text: node.data.promptOptimization.text,
						model: node.data.promptOptimization.modelKey,
						createdAt: node.data.promptOptimization.createdAt,
					},
				}
				: {}),
		},
		activeVersion: node.data.promptOptimization ? "optimized" : "original",
	};
}

function serializeGenerationModel(node: ContentNode) {
	return node.data.providerId && node.data.modelId
		? {
				selection: "specific" as const,
				providerId: node.data.providerId,
				modelId: node.data.modelId,
				...(node.data.modeId ? { modeId: node.data.modeId } : {}),
			}
		: { selection: "automatic" as const };
}

function serializeResult(assetId: string | undefined) {
	return assetId ? ({ state: "available", assetId } as const) : ({ state: "not-generated" } as const);
}

function serializeNodeSources(
	targetNodeId: string,
	targetHandle: string,
	edges: readonly ContentEdge[],
	nodesById: ReadonlyMap<string, ContentNode>,
): NodeOutputSource[] {
	return edges
		.filter((edge) => edge.target === targetNodeId && edge.targetHandle === targetHandle)
		.flatMap((edge): NodeOutputSource[] => {
			const source = nodesById.get(edge.source);
			const output = source ? semanticOutput(source, edge.sourceHandle) : null;
			return output ? [{ fromNode: edge.source, output }] : [];
		});
}

function serializeMediaInputs(
	node: ContentNode,
	edges: readonly ContentEdge[],
	nodesById: ReadonlyMap<string, ContentNode>,
	assetKinds: ReadonlyMap<string, AssetKind>,
	targetHandle: string,
	defaultRole: string,
	assetKind?: AssetKind,
): MediaInput[] {
	const applicableEdges = edges.filter(
		(edge) => edge.target === node.id && edge.targetHandle === targetHandle,
	);
	const inputs = new Map<string, MediaInput>();
	for (const edge of applicableEdges) {
		const source = nodesById.get(edge.source);
		const output = source ? semanticMediaOutput(source, edge.sourceHandle) : null;
		if (!output) continue;
		const bindings = (node.data.inputs ?? []).filter(
			(binding) =>
				binding.sourceNodeId === edge.source &&
				(!assetKind || !assetKinds.has(binding.assetId) || assetKinds.get(binding.assetId) === assetKind),
		);
		if (bindings.length === 0) {
			inputs.set(`${edge.source}:${output}:${defaultRole}`, {
				fromNode: edge.source,
				output,
				assetIds: [],
				role: defaultRole,
			});
			continue;
		}
		for (const binding of bindings) addMediaBinding(inputs, binding, output);
	}
	for (const binding of node.data.inputs ?? []) {
		if (assetKind && assetKinds.has(binding.assetId) && assetKinds.get(binding.assetId) !== assetKind) continue;
		if (binding.sourceNodeId && applicableEdges.some((edge) => edge.source === binding.sourceNodeId)) continue;
		addMediaBinding(inputs, binding, binding.sourceNodeId ? "media-collection" : undefined);
	}
	return [...inputs.values()];
}

function addMediaBinding(
	inputs: Map<string, MediaInput>,
	binding: ContentNodeInputBinding,
	output: MediaInput["output"],
): void {
	const key = `${binding.sourceNodeId ?? "direct"}:${output ?? "asset"}:${binding.slotId}`;
	const existing = inputs.get(key);
	if (existing) {
		if (!existing.assetIds.includes(binding.assetId)) existing.assetIds.push(binding.assetId);
		return;
	}
	inputs.set(key, {
		...(binding.sourceNodeId ? { fromNode: binding.sourceNodeId } : {}),
		...(output ? { output } : {}),
		assetIds: [binding.assetId],
		role: binding.slotId,
	});
}

function semanticOutput(node: ContentNode, sourceHandle: string | undefined): NodeOutputSource["output"] | null {
	if (node.kind === "prompt") return "prompt";
	if (node.kind === "asset") return "media-collection";
	if (node.kind === "image-generator") return "image";
	if (node.kind === "video-generator") return "video";
	if (node.kind === "output" || sourceHandle === "content") return "deliverable";
	return null;
}

function semanticMediaOutput(
	node: ContentNode,
	sourceHandle: string | undefined,
): MediaInput["output"] | null {
	const output = semanticOutput(node, sourceHandle);
	return output === "image" || output === "video" || output === "media-collection" ? output : null;
}
