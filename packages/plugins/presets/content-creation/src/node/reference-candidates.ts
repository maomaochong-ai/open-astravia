import type { ContentAsset, ContentProjectDocument } from "../project/types";
import { isContentInputBindingAvailable, listConnectedContentAssets } from "./material-assets";

export type ContentAssetCandidateOrigin = "attached" | "connected" | "project";

export interface ContentAssetReferenceCandidate {
	asset: ContentAsset;
	origin: ContentAssetCandidateOrigin;
	sourceNodeId?: string;
}

export function listContentAssetReferenceCandidates(
	project: ContentProjectDocument,
	targetNodeId: string,
): ContentAssetReferenceCandidate[] {
	const target = project.graph.nodes.find((node) => node.id === targetNodeId);
	if (!target) return [];
	const assetById = new Map(project.assets.map((asset) => [asset.id, asset]));
	const candidates: ContentAssetReferenceCandidate[] = [];
	const seenAssetIds = new Set<string>();
	const append = (candidate: ContentAssetReferenceCandidate) => {
		if (seenAssetIds.has(candidate.asset.id)) return;
		seenAssetIds.add(candidate.asset.id);
		candidates.push(candidate);
	};

	for (const binding of target.data.inputs ?? []) {
		if (!isContentInputBindingAvailable(project, targetNodeId, binding)) continue;
		const asset = assetById.get(binding.assetId);
		if (asset) append({ asset, origin: "attached", sourceNodeId: binding.sourceNodeId });
	}
	for (const candidate of listConnectedContentAssets(project, targetNodeId)) {
		append({ ...candidate, origin: "connected" });
	}
	for (const asset of project.assets) append({ asset, origin: "project" });

	return candidates;
}
