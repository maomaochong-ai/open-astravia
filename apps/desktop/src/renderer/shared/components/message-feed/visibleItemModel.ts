export interface RenderedFeedItem {
	readonly index: number;
	readonly offset: number;
	readonly size: number;
}

/** Finds the measured item crossing the viewport's top edge, excluding overscan-only rows. */
export function findTopVisibleItemIndex(items: readonly RenderedFeedItem[], scrollTop: number): number | null {
	for (const item of items) {
		if (item.offset + item.size > scrollTop) return item.index;
	}
	return items.at(-1)?.index ?? null;
}
