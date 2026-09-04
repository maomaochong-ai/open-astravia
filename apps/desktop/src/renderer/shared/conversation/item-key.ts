import type { ConversationTimelineItemViewModel } from "./types";

/**
 * Returns the stable DOM key for a rendered conversation item.
 *
 * Aggregated feeds may contain identical storage ids from separate runtime
 * sessions. `renderKey` disambiguates those items without changing their
 * persisted `id` or `entryId` contracts.
 */
export function conversationItemRenderKey(item: ConversationTimelineItemViewModel<{ readonly kind: string }>): string {
	return item.renderKey ?? item.entryId ?? item.id;
}
