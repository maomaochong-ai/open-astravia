import type {
	ContentAsset,
	ContentNode,
	ContentNodeData,
	ContentNodeInputBinding,
	ContentProjectDocument,
} from "../project/types";

export interface ConnectedContentAsset {
	sourceNodeId: string;
	asset: ContentAsset;
}

export function listContentNodeAssetIds(data: ContentNodeData): string[] {
	const ids = [data.assetId, ...(data.assetIds ?? [])].filter((assetId): assetId is string => Boolean(assetId));
	return ids.filter((assetId, index) => ids.indexOf(assetId) === index);
}

export function listContentNodeAssets(
	project: ContentProjectDocument,
	node: Pick<ContentNode, "data">,
): ContentAsset[] {
	const assetById = new Map(project.assets.map((asset) => [asset.id, asset]));
	return listContentNodeAssetIds(node.data).flatMap((assetId) => {
		const asset = assetById.get(assetId);
		return asset ? [asset] : [];
	});
}

export function listConnectedContentAssets(
	project: ContentProjectDocument,
	targetNodeId: string,
): ConnectedContentAsset[] {
	const sourceNodeIds = project.graph.edges
		.filter((edge) => edge.target === targetNodeId)
		.map((edge) => edge.source);
	const candidates = sourceNodeIds.flatMap((sourceNodeId) => {
		const source = project.graph.nodes.find((node) => node.id === sourceNodeId && node.kind === "asset");
		return source
			? listContentNodeAssets(project, source).map((asset) => ({ sourceNodeId: source.id, asset }))
			: [];
	});
	return candidates.filter(
		(candidate, index) =>
			candidates.findIndex(
				(current) => current.sourceNodeId === candidate.sourceNodeId && current.asset.id === candidate.asset.id,
			) === index,
	);
}

export function isContentInputBindingAvailable(
	project: ContentProjectDocument,
	targetNodeId: string,
	binding: ContentNodeInputBinding,
): boolean {
	if (!binding.sourceNodeId) return true;
	const connected = project.graph.edges.some(
		(edge) => edge.source === binding.sourceNodeId && edge.target === targetNodeId,
	);
	if (!connected) return false;
	const source = project.graph.nodes.find((node) => node.id === binding.sourceNodeId && node.kind === "asset");
	return Boolean(source && listContentNodeAssetIds(source.data).includes(binding.assetId));
}
