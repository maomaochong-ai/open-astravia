import type { ContentAsset, ContentProjectDocument } from "../project/types";
import { isContentInputBindingAvailable, listConnectedContentAssets } from "./material-assets";

export type ContentKeyframeSlotId = "firstFrame" | "lastFrame";

export interface ContentKeyframeReference {
	slotId: ContentKeyframeSlotId;
	asset: ContentAsset;
	sourceNodeId?: string;
	origin: "binding" | "node-output";
}

export function isContentKeyframeSlotId(slotId: string | undefined): slotId is ContentKeyframeSlotId {
	return slotId === "firstFrame" || slotId === "lastFrame";
}

export function listContentKeyframeReferences(
	project: ContentProjectDocument,
	targetNodeId: string,
): ContentKeyframeReference[] {
	const target = project.graph.nodes.find((node) => node.id === targetNodeId);
	if (!target) return [];
	const assetById = new Map(project.assets.map((asset) => [asset.id, asset]));
	const references: ContentKeyframeReference[] = [];
	const occupiedSlots = new Set<ContentKeyframeSlotId>();
	const append = (reference: ContentKeyframeReference) => {
		if (reference.asset.kind !== "image" || occupiedSlots.has(reference.slotId)) return;
		occupiedSlots.add(reference.slotId);
		references.push(reference);
	};

	for (const binding of target.data.inputs ?? []) {
		if (!isContentKeyframeSlotId(binding.slotId)) continue;
		if (!isContentInputBindingAvailable(project, targetNodeId, binding)) continue;
		const asset = assetById.get(binding.assetId);
		if (asset) {
			append({
				slotId: binding.slotId,
				asset,
				...(binding.sourceNodeId ? { sourceNodeId: binding.sourceNodeId } : {}),
				origin: "binding",
			});
		}
	}
	for (const candidate of listConnectedContentAssets(project, targetNodeId)) {
		if (!isContentKeyframeSlotId(candidate.role)) continue;
		append({
			slotId: candidate.role,
			asset: candidate.asset,
			sourceNodeId: candidate.sourceNodeId,
			origin: "node-output",
		});
	}

	return references;
}
