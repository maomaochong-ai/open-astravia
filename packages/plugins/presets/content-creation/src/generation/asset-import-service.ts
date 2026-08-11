import { getContentNodeSize } from "../node/geometry";
import { listContentNodeAssetIds } from "../node/material-assets";
import type { ContentProjectCommand } from "../project/commands";
import type {
	AssetKind,
	CanvasPosition,
	ContentAsset,
	ContentNode,
	ContentNodeLayoutOwnership,
	ContentProjectDocument,
} from "../project/types";
import { ContentProjectRevisionError, type ContentCreationWorkspace } from "../project/workspace";
import type { ContentArtifactStore, ImportedContentAsset } from "./types";

export interface ContentAssetImportOptions {
	targetNodeId?: string;
	expectedRevision?: number;
	nodeName?: string;
	nodePurpose?: string;
	layoutOwnership?: ContentNodeLayoutOwnership;
}

export interface ContentAssetImportResult {
	project: ContentProjectDocument;
	assetNodeId: string;
	assets: ContentAsset[];
}

interface PendingAsset {
	asset: ContentAsset;
	file: ImportedContentAsset;
}

/**
 * Single write boundary for imported media, shared by UI uploads and Agent-side local files.
 * File discovery and provider generation deliberately stay outside this service.
 */
export class ContentAssetImportService {
	constructor(
		private readonly workspace: ContentCreationWorkspace,
		private readonly artifacts: ContentArtifactStore,
	) {}

	async import(
		cwd: string | null,
		files: readonly ImportedContentAsset[],
		options: ContentAssetImportOptions = {},
	): Promise<ContentAssetImportResult> {
		const project = await this.workspace.load(cwd);
		assertExpectedRevision(project, options.expectedRevision);
		const existingNode = options.targetNodeId
			? requireAssetNode(project, options.targetNodeId)
			: undefined;
		if (files.length === 0) {
			if (!existingNode) throw new Error("cannot create an empty asset node");
			return { project, assetNodeId: existingNode.id, assets: [] };
		}
		const assetNodeId = existingNode?.id ?? crypto.randomUUID();

		const pending = files.map(createPendingAsset);
		for (const item of pending) {
			const stored = await this.artifacts.putImported(item.asset.id, item.file);
			item.asset.blobId = stored.blobId;
			item.asset.mimeType = stored.mimeType;
		}

		const importedAssets = pending.map(({ asset }) => asset);
		const assetIds = [
			...(existingNode ? listContentNodeAssetIds(existingNode.data) : []),
			...importedAssets.map(({ id }) => id),
		];
		const commands: ContentProjectCommand[] = [
			...importedAssets.map((asset) => ({ type: "asset.add" as const, asset })),
			existingNode
				? { type: "node.update", nodeId: existingNode.id, data: { assetId: undefined, assetIds } }
				: {
						type: "node.add",
						node: {
							id: assetNodeId,
							kind: "asset",
							name: options.nodeName?.trim() || defaultAssetNodeName(importedAssets),
							purpose: options.nodePurpose?.trim() || "Imported source media",
							position: nextNodePosition(project.graph.nodes),
							data: { assetIds },
							layoutOwnership: options.layoutOwnership,
						},
					},
		];
		const next = await this.workspace.dispatch(cwd, commands, project.revision);
		return { project: next, assetNodeId, assets: importedAssets };
	}
}

function assertExpectedRevision(project: ContentProjectDocument, expectedRevision?: number): void {
	if (expectedRevision !== undefined && project.revision !== expectedRevision) {
		throw new ContentProjectRevisionError(expectedRevision, project.revision);
	}
}

function requireAssetNode(project: ContentProjectDocument, nodeId: string): ContentNode {
	const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) throw new Error(`content node not found: ${nodeId}`);
	if (node.kind !== "asset") throw new Error(`node does not accept content assets: ${node.kind}`);
	return node;
}

function createPendingAsset(file: ImportedContentAsset): PendingAsset {
	const kind = assetKindForMimeType(file.mimeType);
	if (!kind) throw new Error(`unsupported content asset type: ${file.mimeType}`);
	const assetId = crypto.randomUUID();
	return {
		file,
		asset: {
			id: assetId,
			blobId: assetId,
			kind,
			name: file.name.trim() || `${kind}-${assetId.slice(0, 8)}.${extensionForMimeType(file.mimeType)}`,
			mimeType: file.mimeType,
			...(file.width === undefined ? {} : { width: file.width }),
			...(file.height === undefined ? {} : { height: file.height }),
			createdAt: new Date().toISOString(),
		},
	};
}

function nextNodePosition(nodes: readonly ContentNode[]): CanvasPosition {
	if (nodes.length === 0) return { x: 0, y: 0 };
	const rightmost = nodes.reduce((current, node) => {
		return node.position.x + nodeWidth(node) > current.position.x + nodeWidth(current)
			? node
			: current;
	});
	return { x: rightmost.position.x + nodeWidth(rightmost) + 80, y: rightmost.position.y };
}

function nodeWidth(node: ContentNode): number {
	const fallback = getContentNodeSize(node.kind, node.data.aspectRatio);
	return node.width ?? fallback.width;
}

function defaultAssetNodeName(assets: readonly ContentAsset[]): string {
	if (assets.length === 1) return assets[0]?.name || "Imported media";
	return `Imported media (${assets.length})`;
}

export function assetKindForMimeType(mimeType: string): AssetKind | null {
	if (mimeType.startsWith("image/")) return "image";
	if (mimeType.startsWith("video/")) return "video";
	if (mimeType.startsWith("audio/")) return "audio";
	return null;
}

export function extensionForMimeType(mimeType: string): string {
	if (mimeType === "image/jpeg") return "jpg";
	if (mimeType === "image/webp") return "webp";
	if (mimeType === "image/gif") return "gif";
	if (mimeType === "image/avif") return "avif";
	if (mimeType === "video/webm") return "webm";
	if (mimeType === "video/quicktime") return "mov";
	if (mimeType.startsWith("video/")) return "mp4";
	if (mimeType === "audio/wav") return "wav";
	if (mimeType === "audio/ogg") return "ogg";
	if (mimeType === "audio/mp4") return "m4a";
	if (mimeType.startsWith("audio/")) return "mp3";
	return "png";
}
