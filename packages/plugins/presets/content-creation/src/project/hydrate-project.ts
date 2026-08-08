import type {
	ContentNode,
	ContentNodeData,
	ContentNodeInputBinding,
	ContentNodeStatus,
	ContentProjectDocument,
	ContentProjectRuntimeDocument,
	ContentPromptSegment,
} from "./types";
import type {
	ContentProjectFile,
	GenerationModel,
	MediaInput,
	NodeOutputSource,
	PromptContent,
	PromptSegment,
	WorkflowNode,
} from "./document-schema";

export function hydrateContentProject(
	document: ContentProjectFile,
	cwd: string | null,
	runtime: ContentProjectRuntimeDocument,
): ContentProjectDocument {
	return {
		schemaVersion: document.schemaVersion,
		revision: document.revision,
		projectId: document.projectId,
		cwd,
		createdAt: document.createdAt,
		updatedAt: document.updatedAt,
		workflow: structuredClone(document.workflow),
		graph: {
			nodes: document.nodes.map((node) => hydrateNode(node, document, runtime.nodeStatuses[node.id])),
			edges: hydrateEdges(document.nodes),
		},
		assets: document.assets.map((asset) => ({
			id: asset.id,
			...(asset.source.storage === "managed"
				? { blobId: asset.source.blobId }
				: { filePath: asset.source.path }),
			kind: asset.type,
			name: asset.name,
			mimeType: asset.metadata.mimeType,
			...(asset.metadata.durationSeconds === undefined
				? {}
				: { duration: asset.metadata.durationSeconds }),
			...(asset.metadata.width === undefined ? {} : { width: asset.metadata.width }),
			...(asset.metadata.height === undefined ? {} : { height: asset.metadata.height }),
			createdAt: asset.createdAt,
		})),
		jobs: structuredClone(runtime.jobs),
		timeline: structuredClone(document.timeline),
	};
}

function hydrateNode(
	node: WorkflowNode,
	document: ContentProjectFile,
	status: ContentNodeStatus | undefined,
): ContentNode {
	const view = document.view.nodes[node.id] ?? { x: 0, y: 0 };
	const common = {
		id: node.id,
		kind: node.type,
		name: node.name,
		purpose: node.purpose,
		position: { x: view.x, y: view.y },
		...(view.width === undefined ? {} : { width: view.width }),
		...(view.height === undefined ? {} : { height: view.height }),
		...(view.locked === undefined ? {} : { locked: view.locked }),
		status: status ?? ("idle" as const),
	};
	if (node.type === "prompt") {
		return {
			...common,
			kind: "prompt",
			data: hydratePromptData(node.content, node.inputs.mediaSources),
		};
	}
	if (node.type === "image-generator") {
		return {
			...common,
			kind: "image-generator",
			data: {
				...hydratePromptData(node.content, node.inputs.referenceImages, node.inputs.promptSources),
				...hydrateGenerationModel(node.generation.model),
				...(node.generation.aspectRatio ? { aspectRatio: node.generation.aspectRatio } : {}),
				...(node.generation.quality ? { quality: node.generation.quality } : {}),
				...(node.result.state === "available" ? { assetId: node.result.assetId } : {}),
			},
		};
	}
	if (node.type === "video-generator") {
		return {
			...common,
			kind: "video-generator",
			data: {
				...hydratePromptData(
					node.content,
					[...node.inputs.startImages, ...node.inputs.referenceVideos],
					node.inputs.promptSources,
				),
				...hydrateGenerationModel(node.generation.model),
				...(node.generation.aspectRatio ? { aspectRatio: node.generation.aspectRatio } : {}),
				...(node.generation.durationSeconds === undefined
					? {}
					: { duration: node.generation.durationSeconds }),
				...(node.generation.resolution ? { resolution: node.generation.resolution } : {}),
				...(node.result.state === "available" ? { assetId: node.result.assetId } : {}),
			},
		};
	}
	if (node.type === "asset") {
		return { ...common, kind: "asset", data: { assetIds: [...node.assets] } };
	}
	return {
		...common,
		kind: "output",
		data: node.result.state === "available" ? { assetId: node.result.assetId } : {},
	};
}

function hydratePromptData(
	content: PromptContent,
	mediaInputs: readonly MediaInput[],
	promptSources: readonly NodeOutputSource[] = [],
): ContentNodeData {
	const bindings: ContentNodeInputBinding[] = [];
	const bindingByAssetRole = new Map<string, ContentNodeInputBinding>();
	for (const input of mediaInputs) {
		for (const assetId of input.assetIds) {
			const binding = createBinding(bindings.length, assetId, input.role, input.fromNode);
			bindings.push(binding);
			bindingByAssetRole.set(`${assetId}:${input.role}`, binding);
		}
	}
	const segments = content.versions.original.segments.flatMap((segment): ContentPromptSegment[] => {
		if (segment.type === "text") return [{ type: "text", text: segment.value }];
		if (segment.type === "node-output-reference") {
			return [{ type: "prompt-reference", sourceNodeId: segment.nodeId }];
		}
		let binding = bindingByAssetRole.get(`${segment.assetId}:${segment.role}`);
		if (!binding) {
			binding = createBinding(bindings.length, segment.assetId, segment.role);
			bindings.push(binding);
			bindingByAssetRole.set(`${segment.assetId}:${segment.role}`, binding);
		}
		return [{ type: "asset-reference", bindingId: binding.id }];
	});
	if (segments.length === 0 && promptSources[0]?.output === "prompt") {
		segments.push({ type: "prompt-reference", sourceNodeId: promptSources[0].fromNode });
	}
	const originalText = content.versions.original.segments
		.flatMap((segment) => (segment.type === "text" ? [segment.value] : []))
		.join("")
		.trim();
	const promptSource = content.versions.original.segments.find(
		(segment): segment is Extract<PromptSegment, { type: "node-output-reference" }> =>
			segment.type === "node-output-reference",
	);
	const optimized = content.activeVersion === "optimized" ? content.versions.optimized : undefined;
	return {
		...(originalText ? { prompt: originalText } : {}),
		promptDocument: { version: 1, segments },
		...(optimized
			? {
					promptOptimization: {
						text: optimized.text,
						modelKey: optimized.model,
						createdAt: optimized.createdAt,
					},
				}
			: {}),
		...(promptSource
			? { promptSourceNodeId: promptSource.nodeId }
			: promptSources[0]?.output === "prompt"
				? { promptSourceNodeId: promptSources[0].fromNode }
				: {}),
		...(bindings.length > 0 ? { inputs: bindings } : {}),
	};
}

function hydrateGenerationModel(model: GenerationModel): Pick<
	ContentNodeData,
	"providerId" | "modelId" | "modeId"
> {
	if (model.selection !== "specific") return {};
	return {
		providerId: model.providerId,
		modelId: model.modelId,
		...(model.modeId ? { modeId: model.modeId } : {}),
	};
}

function createBinding(
	index: number,
	assetId: string,
	slotId: string,
	sourceNodeId?: string,
): ContentNodeInputBinding {
	return {
		id: `binding-${index + 1}`,
		assetId,
		slotId,
		...(sourceNodeId ? { sourceNodeId } : {}),
	};
}

function hydrateEdges(nodes: readonly WorkflowNode[]) {
	const edges = new Map<string, ReturnType<typeof createEdge>>();
	for (const node of nodes) {
		if (node.type === "prompt") {
			addMediaEdges(edges, node.id, "media", node.inputs.mediaSources);
			continue;
		}
		if (node.type === "image-generator") {
			addNodeEdges(edges, node.id, "prompt", node.inputs.promptSources);
			addMediaEdges(edges, node.id, "reference", node.inputs.referenceImages);
			continue;
		}
		if (node.type === "video-generator") {
			addNodeEdges(edges, node.id, "prompt", node.inputs.promptSources);
			addMediaEdges(edges, node.id, "image", node.inputs.startImages);
			addMediaEdges(edges, node.id, "video", node.inputs.referenceVideos);
			continue;
		}
		if (node.type === "output") addNodeEdges(edges, node.id, "content", node.inputs.contentSources);
	}
	return [...edges.values()];
}

function addNodeEdges(
	edges: Map<string, ReturnType<typeof createEdge>>,
	target: string,
	targetHandle: string,
	sources: readonly NodeOutputSource[],
): void {
	for (const source of sources) {
		const edge = createEdge(source.fromNode, target, sourceHandle(source.output), targetHandle);
		edges.set(edge.id, edge);
	}
}

function addMediaEdges(
	edges: Map<string, ReturnType<typeof createEdge>>,
	target: string,
	targetHandle: string,
	sources: readonly MediaInput[],
): void {
	for (const source of sources) {
		if (!source.fromNode || !source.output) continue;
		const edge = createEdge(source.fromNode, target, sourceHandle(source.output), targetHandle);
		edges.set(edge.id, edge);
	}
}

function createEdge(source: string, target: string, sourceHandle: string, targetHandle: string) {
	return {
		id: `edge:${source}:${sourceHandle}:${target}:${targetHandle}`,
		source,
		target,
		sourceHandle,
		targetHandle,
	};
}

function sourceHandle(output: NodeOutputSource["output"] | NonNullable<MediaInput["output"]>): string {
	if (output === "prompt") return "text";
	if (output === "media-collection") return "media";
	return output;
}
