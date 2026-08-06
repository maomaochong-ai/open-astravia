import type { ContentAsset, ContentNodeData } from "../project/types";
import { createContentPromptDocument } from "../node/prompt-document";

export function serializeContentPromptForOptimization(
	data: ContentNodeData,
	assetByBindingId: ReadonlyMap<string, ContentAsset>,
): string {
	return createContentPromptDocument(data)
		.segments.map((segment) => {
			if (segment.type === "text") return segment.text;
			if (segment.type === "asset-reference") {
				const asset = assetByBindingId.get(segment.bindingId);
				return asset ? `@${asset.name}` : `@${segment.bindingId}`;
			}
			return `@prompt:${segment.sourceNodeId}`;
		})
		.join("")
		.trim();
}
