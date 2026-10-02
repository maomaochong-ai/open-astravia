import { cn } from "@vetta-org/ui";
import { Slot } from "radix-ui";
import type { ComponentPropsWithoutRef, JSX, ReactNode, Ref } from "react";
import { forwardRef, useRef } from "react";
import { createPortal } from "react-dom";
import {
	type FollowOutput,
	type IndexLocationWithAlign,
	type ListItem,
	type ListRange,
	type SizeFunction,
	type StateSnapshot,
	Virtuoso,
	type VirtuosoHandle,
} from "react-virtuoso";
import { MessageFeedProvider, useMessageFeedContext } from "./MessageFeedContext";
import { MessageFeedLayoutList } from "./MessageFeedLayoutView";

export interface MessageFeedRootProps {
	readonly children: ReactNode;
}

/** State boundary only. The caller composes the concrete host from MessageFeedLayout. */
export function MessageFeedRoot({ children }: MessageFeedRootProps): JSX.Element {
	return <MessageFeedProvider>{children}</MessageFeedProvider>;
}

export interface MessageFeedPrimitiveProps extends ComponentPropsWithoutRef<"div"> {
	readonly asChild?: boolean;
}

export const MessageFeedFooter = forwardRef<HTMLDivElement, MessageFeedPrimitiveProps>(function MessageFeedFooter(
	{ asChild = false, children, className, ...props },
	forwardedRef,
) {
	const { footerHost } = useMessageFeedContext("MessageFeed.Footer");
	if (!footerHost) return null;
	const Comp = asChild ? Slot.Root : "div";
	return createPortal(
		<Comp ref={forwardedRef} className={cn(className)} data-message-feed-part="footer" {...props}>
			{children}
		</Comp>,
		footerHost,
	);
});

/**
 * Virtuoso positions, measures and keeps the scroll offset of items by index. An
 * index is only a stable identity while nothing is inserted above: loading older
 * history in front of the shown items would hand their indices, sizes and scroll
 * position to other items. The list therefore numbers items from a high base and
 * lowers it by the number of items inserted above (Virtuoso's `firstItemIndex`),
 * so every item keeps its index for as long as it stays in the list.
 */
export const FIRST_ITEM_INDEX_BASE = 100_000_000;

/**
 * The first item's index after `items` replaced `previous`, anchored on an item
 * both lists share: the previous first item if items were inserted before it, or
 * the new first item if items were removed from the top. Unrelated lists keep it.
 */
export function anchoredFirstItemIndex<T>(
	previous: readonly T[],
	items: readonly T[],
	firstItemIndex: number,
	getKey: (item: T, index: number) => string | number,
): number {
	if (previous.length === 0 || items.length === 0) return firstItemIndex;
	const previousFirst = getKey(previous[0], 0);
	const first = getKey(items[0], 0);
	if (previousFirst === first) return firstItemIndex;
	const inserted = items.findIndex((item, index) => getKey(item, index) === previousFirst);
	if (inserted > 0) return Math.max(0, firstItemIndex - inserted);
	const removed = previous.findIndex((item, index) => getKey(item, index) === first);
	return removed > 0 ? firstItemIndex + removed : firstItemIndex;
}

/** The first item's index for this render; it changes only when the items do. */
function useAnchoredFirstItemIndex<T>(
	items: readonly T[],
	getKey: ((item: T, index: number) => string | number) | undefined,
): number {
	const state = useRef({ items, firstItemIndex: FIRST_ITEM_INDEX_BASE });
	if (state.current.items !== items) {
		state.current = {
			items,
			firstItemIndex: getKey
				? anchoredFirstItemIndex(state.current.items, items, state.current.firstItemIndex, getKey)
				: state.current.firstItemIndex,
		};
	}
	return state.current.firstItemIndex;
}

export interface MessageFeedVirtualListProps<T> extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
	readonly items: readonly T[];
	/** Renders one item; `index` is its position in `items`. */
	readonly children: (item: T, index: number) => ReactNode;
	/** Item identity. It also keeps shown items in place when items are inserted above them. */
	readonly getKey?: (item: T, index: number) => string | number;
	readonly virtuosoRef?: Ref<VirtuosoHandle>;
	readonly scrollerRef?: (ref: HTMLElement | Window | null) => void;
	readonly atBottomStateChange?: (atBottom: boolean) => void;
	readonly totalListHeightChanged?: (height: number) => void;
	/** Rendered items; their `index` is the position in `items`. */
	readonly itemsRendered?: (items: ListItem<T>[]) => void;
	/** The rendered range as positions in `items`. */
	readonly rangeChanged?: (range: ListRange) => void;
	readonly restoreStateFrom?: StateSnapshot;
	readonly followOutput?: FollowOutput;
	readonly initialTopMostItemIndex?: IndexLocationWithAlign | number;
	readonly overscan?: number | { main: number; reverse: number };
	readonly minOverscanItemCount?: number | { readonly top: number; readonly bottom: number };
	readonly increaseViewportBy?: number | { readonly top: number; readonly bottom: number };
	readonly defaultItemHeight?: number;
	readonly heightEstimates?: number[];
	readonly itemSize?: SizeFunction;
	readonly atBottomThreshold?: number;
}

/** Generic virtualized feed mechanics; item semantics and layout stay in caller composition. */
export function MessageFeedVirtualList<T>({
	items,
	children,
	getKey,
	virtuosoRef,
	scrollerRef,
	atBottomStateChange,
	totalListHeightChanged,
	itemsRendered,
	rangeChanged,
	restoreStateFrom,
	followOutput,
	initialTopMostItemIndex,
	overscan,
	increaseViewportBy,
	minOverscanItemCount,
	defaultItemHeight,
	heightEstimates,
	itemSize,
	atBottomThreshold,
	className,
	style,
	...hostProps
}: MessageFeedVirtualListProps<T>): JSX.Element {
	useMessageFeedContext("MessageFeed.VirtualList");
	const firstItemIndex = useAnchoredFirstItemIndex(items, getKey);
	// Virtuoso only accepts the first source that seeds an empty size tree. Forwarding both
	// makes the uniform default win before per-item estimates can describe tall message rows.
	const initialSizeProps =
		heightEstimates !== undefined && heightEstimates.length > 0
			? { heightEstimates }
			: defaultItemHeight !== undefined
				? { defaultItemHeight }
				: {};
	return (
		<Virtuoso
			{...hostProps}
			ref={virtuosoRef}
			data={items}
			firstItemIndex={firstItemIndex}
			skipAnimationFrameInResizeObserver
			itemContent={(index, item) => children(item, index - firstItemIndex)}
			{...(getKey
				? { computeItemKey: (index: number, item: T) => getKey(item, index - firstItemIndex) }
				: {})}
			{...(scrollerRef ? { scrollerRef } : {})}
			{...(atBottomStateChange ? { atBottomStateChange } : {})}
			{...(totalListHeightChanged ? { totalListHeightChanged } : {})}
			{...(itemsRendered
				? {
						itemsRendered: (rendered: ListItem<T>[]) =>
							itemsRendered(rendered.map((item) => ({ ...item, index: item.index - firstItemIndex }))),
					}
				: {})}
			{...(rangeChanged
				? {
						rangeChanged: (range: ListRange) =>
							rangeChanged({
								startIndex: range.startIndex - firstItemIndex,
								endIndex: range.endIndex - firstItemIndex,
							}),
					}
				: {})}
			{...(restoreStateFrom ? { restoreStateFrom } : {})}
			{...(followOutput !== undefined ? { followOutput } : {})}
			{...(initialTopMostItemIndex !== undefined ? { initialTopMostItemIndex } : {})}
			{...(overscan !== undefined ? { overscan } : {})}
			{...(minOverscanItemCount !== undefined ? { minOverscanItemCount } : {})}
			{...(increaseViewportBy !== undefined ? { increaseViewportBy } : {})}
			{...initialSizeProps}
			{...(itemSize !== undefined ? { itemSize } : {})}
			{...(atBottomThreshold !== undefined ? { atBottomThreshold } : {})}
			components={VIRTUAL_COMPONENTS}
			className={cn(className)}
			style={style}
		/>
	);
}

function MessageFeedVirtualFooterSlot(): JSX.Element {
	const { setFooterHost } = useMessageFeedContext("MessageFeed.VirtualFooter");
	return <div ref={setFooterHost} />;
}

const VIRTUAL_COMPONENTS = { List: MessageFeedLayoutList, Footer: MessageFeedVirtualFooterSlot };

export const MessageFeed = {
	Root: MessageFeedRoot,
	VirtualList: MessageFeedVirtualList,
	Footer: MessageFeedFooter,
} as const;
