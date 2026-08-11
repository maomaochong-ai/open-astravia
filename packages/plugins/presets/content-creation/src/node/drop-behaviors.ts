import type { ContentNodeKind } from "../project/types";

export interface ContentNodeFileDropBehavior {
	action: "append-assets";
}

const CONTENT_NODE_FILE_DROP_BEHAVIORS: Partial<Record<ContentNodeKind, ContentNodeFileDropBehavior>> = {
	asset: { action: "append-assets" },
};

export function getContentNodeFileDropBehavior(
	kind: ContentNodeKind,
): ContentNodeFileDropBehavior | undefined {
	return CONTENT_NODE_FILE_DROP_BEHAVIORS[kind];
}
