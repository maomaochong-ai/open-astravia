import type { ConfigRecord, VersionedConfigMigration } from "@vetta/toolkit/versioned-config";
import { CONTENT_CREATION_FORMAT } from "../types";
import type { ContentNodeKind } from "../types";
import { getDefaultNodePurpose } from "../node-semantics";

function isRecord(value: unknown): value is ConfigRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): ConfigRecord {
	return isRecord(value) ? value : {};
}

function asRecords(value: unknown): ConfigRecord[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function migratePromptContent(data: ConfigRecord, fallbackPromptSource?: ConfigRecord) {
	const bindings = new Map(
		asRecords(data.inputs).map((binding) => [asString(binding.id), binding] as const),
	);
	const representedBindings = new Set<string>();
	const document = asRecord(data.promptDocument);
	const rawSegments = Array.isArray(document.segments) ? document.segments : [];
	const segments = rawSegments.flatMap((value): ConfigRecord[] => {
		if (!isRecord(value)) return [];
		if (value.type === "text" && typeof value.text === "string") {
			return [{ type: "text", value: value.text }];
		}
		if (value.type === "prompt-reference" && typeof value.sourceNodeId === "string") {
			return [{ type: "node-output-reference", nodeId: value.sourceNodeId, output: "prompt" }];
		}
		if (value.type !== "asset-reference" || typeof value.bindingId !== "string") return [];
		const binding = bindings.get(value.bindingId);
		if (!binding) return [];
		representedBindings.add(value.bindingId);
		return [
			{
				type: "asset-reference",
				assetId: asString(binding.assetId),
				role: asString(binding.slotId, "reference"),
			},
		];
	});
	if (segments.length === 0) {
		if (typeof data.promptSourceNodeId === "string" && data.promptSourceNodeId) {
			segments.push({ type: "node-output-reference", nodeId: data.promptSourceNodeId, output: "prompt" });
		} else if (typeof data.prompt === "string" && data.prompt) {
			segments.push({ type: "text", value: data.prompt });
		}
	}
	if (
		segments.length === 0 &&
		fallbackPromptSource?.output === "prompt" &&
		typeof fallbackPromptSource.fromNode === "string"
	) {
		segments.push({
			type: "node-output-reference",
			nodeId: fallbackPromptSource.fromNode,
			output: "prompt",
		});
	}
	for (const [bindingId, binding] of bindings) {
		if (representedBindings.has(bindingId)) continue;
		segments.push({
			type: "asset-reference",
			assetId: asString(binding.assetId),
			role: asString(binding.slotId, "reference"),
		});
	}
	const optimization = asRecord(data.promptOptimization);
	const hasOptimization =
		typeof optimization.text === "string" &&
		typeof optimization.modelKey === "string" &&
		typeof optimization.createdAt === "string";
	return {
		versions: {
			original: { segments },
			...(hasOptimization
				? {
						optimized: {
							text: optimization.text,
							model: optimization.modelKey,
							createdAt: optimization.createdAt,
						},
					}
				: {}),
		},
		activeVersion: hasOptimization ? "optimized" : "original",
	};
}

function migrateModel(data: ConfigRecord) {
	return typeof data.providerId === "string" && typeof data.modelId === "string"
		? {
				selection: "specific",
				providerId: data.providerId,
				modelId: data.modelId,
				...(asOptionalString(data.modeId) ? { modeId: data.modeId } : {}),
			}
		: { selection: "automatic" };
}

function migrateResult(data: ConfigRecord) {
	return typeof data.assetId === "string"
		? { state: "available", assetId: data.assetId }
		: { state: "not-generated" };
}

function sourceOutput(source: ConfigRecord): string | null {
	if (source.kind === "prompt") return "prompt";
	if (source.kind === "asset") return "media-collection";
	if (source.kind === "image-generator") return "image";
	if (source.kind === "video-generator") return "video";
	if (source.kind === "output") return "deliverable";
	return null;
}

function migrateNodeSources(
	targetId: string,
	targetHandle: string,
	edges: readonly ConfigRecord[],
	nodesById: ReadonlyMap<string, ConfigRecord>,
) {
	return edges.flatMap((edge): ConfigRecord[] => {
		if (edge.target !== targetId || edge.targetHandle !== targetHandle || typeof edge.source !== "string") {
			return [];
		}
		const source = nodesById.get(edge.source);
		const output = source ? sourceOutput(source) : null;
		return output ? [{ fromNode: edge.source, output }] : [];
	});
}

function migrateMediaInputs(
	node: ConfigRecord,
	targetHandle: string,
	defaultRole: string,
	edges: readonly ConfigRecord[],
	nodesById: ReadonlyMap<string, ConfigRecord>,
	assetKinds: ReadonlyMap<string, string>,
	assetKind?: string,
) {
	const data = asRecord(node.data);
	const bindings = asRecords(data.inputs).filter((binding) => {
		const kind = assetKinds.get(asString(binding.assetId));
		return !assetKind || !kind || kind === assetKind;
	});
	const inputs = new Map<string, ConfigRecord>();
	for (const edge of edges) {
		if (
			edge.target !== node.id ||
			edge.targetHandle !== targetHandle ||
			typeof edge.source !== "string"
		) {
			continue;
		}
		const source = nodesById.get(edge.source);
		const output = source ? sourceOutput(source) : null;
		if (output !== "image" && output !== "video" && output !== "media-collection") continue;
		const selected = bindings.filter((binding) => binding.sourceNodeId === edge.source);
		if (selected.length === 0) {
			inputs.set(`${edge.source}:${defaultRole}`, {
				fromNode: edge.source,
				output,
				assetIds: [],
				role: defaultRole,
			});
		}
		for (const binding of selected) addBinding(inputs, binding, output);
	}
	for (const binding of bindings) {
		const connected = edges.some(
			(edge) => edge.target === node.id && edge.targetHandle === targetHandle && edge.source === binding.sourceNodeId,
		);
		if (!connected) addBinding(inputs, binding, binding.sourceNodeId ? "media-collection" : undefined);
	}
	return [...inputs.values()];
}

function addBinding(inputs: Map<string, ConfigRecord>, binding: ConfigRecord, output?: string): void {
	const sourceNodeId = asOptionalString(binding.sourceNodeId);
	const role = asString(binding.slotId, "reference");
	const assetId = asString(binding.assetId);
	const key = `${sourceNodeId ?? "direct"}:${output ?? "asset"}:${role}`;
	const existing = inputs.get(key);
	if (existing && Array.isArray(existing.assetIds)) {
		if (!existing.assetIds.includes(assetId)) existing.assetIds.push(assetId);
		return;
	}
	inputs.set(key, {
		...(sourceNodeId ? { fromNode: sourceNodeId } : {}),
		...(output ? { output } : {}),
		assetIds: [assetId],
		role,
	});
}

function migrateNode(
	node: ConfigRecord,
	edges: readonly ConfigRecord[],
	nodesById: ReadonlyMap<string, ConfigRecord>,
	assetKinds: ReadonlyMap<string, string>,
) {
	const kind = node.kind as ContentNodeKind;
	const data = asRecord(node.data);
	const common = {
		id: asString(node.id),
		name: asString(node.name, asString(node.kind, "node")),
		purpose: getDefaultNodePurpose(kind),
	};
	if (kind === "prompt") {
		return {
			...common,
			type: "prompt",
			content: migratePromptContent(data),
			inputs: {
				mediaSources: migrateMediaInputs(node, "media", "reference", edges, nodesById, assetKinds),
			},
			produces: { type: "prompt" },
		};
	}
	if (kind === "image-generator") {
		const promptSources = migrateNodeSources(common.id, "prompt", edges, nodesById);
		return {
			...common,
			type: kind,
			content: migratePromptContent(data, promptSources[0]),
			inputs: {
				promptSources,
				referenceImages: migrateMediaInputs(
					node,
					"reference",
					"reference-image",
					edges,
					nodesById,
					assetKinds,
					"image",
				),
			},
			generation: {
				model: migrateModel(data),
				...(asOptionalString(data.aspectRatio) ? { aspectRatio: data.aspectRatio } : {}),
				...(asOptionalString(data.quality) ? { quality: data.quality } : {}),
			},
			produces: { type: "image" },
			result: migrateResult(data),
		};
	}
	if (kind === "video-generator") {
		const promptSources = migrateNodeSources(common.id, "prompt", edges, nodesById);
		return {
			...common,
			type: kind,
			content: migratePromptContent(data, promptSources[0]),
			inputs: {
				promptSources,
				startImages: migrateMediaInputs(
					node,
					"image",
					"start-image",
					edges,
					nodesById,
					assetKinds,
					"image",
				),
				referenceVideos: migrateMediaInputs(
					node,
					"video",
					"reference-video",
					edges,
					nodesById,
					assetKinds,
					"video",
				),
			},
			generation: {
				model: migrateModel(data),
				...(asOptionalString(data.aspectRatio) ? { aspectRatio: data.aspectRatio } : {}),
				...(asOptionalNumber(data.duration) === undefined ? {} : { durationSeconds: data.duration }),
				...(asOptionalString(data.resolution) ? { resolution: data.resolution } : {}),
			},
			produces: { type: "video" },
			result: migrateResult(data),
		};
	}
	if (kind === "asset") {
		return {
			...common,
			type: kind,
			assets: Array.isArray(data.assetIds) ? data.assetIds.filter((id): id is string => typeof id === "string") : [],
			produces: { type: "media-collection" },
		};
	}
	return {
		...common,
		type: "output",
		inputs: { contentSources: migrateNodeSources(common.id, "content", edges, nodesById) },
		produces: { type: "deliverable" },
		result: migrateResult(data),
	};
}

export const contentProjectMigration003To4: VersionedConfigMigration = {
	fromVersion: 3,
	toVersion: 4,
	migrate(config) {
		const graph = asRecord(config.graph);
		const nodes = asRecords(graph.nodes);
		const edges = asRecords(graph.edges);
		const assets = asRecords(config.assets);
		const nodesById = new Map(nodes.map((node) => [asString(node.id), node] as const));
		const assetKinds = new Map(assets.map((asset) => [asString(asset.id), asString(asset.kind)] as const));
		const generatedByAsset = new Map(
			nodes.flatMap((node) => {
				const assetId = asOptionalString(asRecord(node.data).assetId);
				return assetId ? [[assetId, asString(node.id)] as const] : [];
			}),
		);
		return {
			format: CONTENT_CREATION_FORMAT,
			schemaVersion: 4,
			revision: typeof config.revision === "number" ? config.revision : 0,
			projectId: asString(config.projectId),
			createdAt: asString(config.createdAt),
			updatedAt: asString(config.updatedAt),
			workflow: {
				title: "Untitled content workflow",
				objective: "",
				deliverables: nodes
					.filter((node) => node.kind === "output")
					.map((node) => ({
						type: "content",
						fromNode: asString(node.id),
						description: asString(node.name, "Workflow output"),
					})),
			},
			nodes: nodes.map((node) => migrateNode(node, edges, nodesById, assetKinds)),
			assets: assets.map((asset) => {
				const id = asString(asset.id);
				const generatedBy = generatedByAsset.get(id);
				return {
					id,
					name: asString(asset.name),
					type: asString(asset.kind),
					source: typeof asset.filePath === "string"
						? { storage: "workspace", path: asset.filePath }
						: { storage: "managed", blobId: asString(asset.blobId, id) },
					origin: generatedBy
						? { type: "generated", byNode: generatedBy }
						: { type: "user-imported" },
					metadata: {
						mimeType: asString(asset.mimeType),
						...(asOptionalNumber(asset.width) === undefined ? {} : { width: asset.width }),
						...(asOptionalNumber(asset.height) === undefined ? {} : { height: asset.height }),
						...(asOptionalNumber(asset.duration) === undefined
							? {}
							: { durationSeconds: asset.duration }),
					},
					createdAt: asString(asset.createdAt),
				};
			}),
			view: {
				nodes: Object.fromEntries(
					nodes.map((node) => {
						const position = asRecord(node.position);
						return [
							asString(node.id),
							{
								x: typeof position.x === "number" ? position.x : 0,
								y: typeof position.y === "number" ? position.y : 0,
								...(asOptionalNumber(node.width) === undefined ? {} : { width: node.width }),
								...(asOptionalNumber(node.height) === undefined ? {} : { height: node.height }),
								...(typeof node.locked === "boolean" ? { locked: node.locked } : {}),
							},
						];
					}),
				),
			},
			timeline: config.timeline,
		};
	},
};
