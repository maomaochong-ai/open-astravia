import { cn } from "@vetta-org/ui";
import { Slot } from "radix-ui";
import type { ComponentPropsWithoutRef, JSX, ReactNode, Ref } from "react";
import { forwardRef } from "react";
import { createPortal } from "react-dom";
import {
	type FollowOutput,
	type ListItem,
	type ListRange,
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

export interface MessageFeedVirtualListProps<T> extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
	readonly items: readonly T[];
	readonly children: (item: T, index: number) => ReactNode;
	readonly getKey?: (item: T, index: number) => string | number;
	readonly virtuosoRef?: Ref<VirtuosoHandle>;
	readonly scrollerRef?: (ref: HTMLElement | Window | null) => void;
	readonly atBottomStateChange?: (atBottom: boolean) => void;
	readonly itemsRendered?: (items: ListItem<T>[]) => void;
	readonly rangeChanged?: (range: ListRange) => void;
	readonly restoreStateFrom?: StateSnapshot;
	readonly followOutput?: FollowOutput;
	readonly initialTopMostItemIndex?: number;
	readonly overscan?: number | { main: number; reverse: number };
	readonly minOverscanItemCount?: number | { readonly top: number; readonly bottom: number };
	readonly increaseViewportBy?: number | { readonly top: number; readonly bottom: number };
	readonly defaultItemHeight?: number;
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
	itemsRendered,
	rangeChanged,
	restoreStateFrom,
	followOutput,
	initialTopMostItemIndex,
	overscan,
	increaseViewportBy,
	minOverscanItemCount,
	defaultItemHeight,
	atBottomThreshold,
	className,
	style,
	...hostProps
}: MessageFeedVirtualListProps<T>): JSX.Element {
	useMessageFeedContext("MessageFeed.VirtualList");
	return (
		<Virtuoso
			{...hostProps}
			ref={virtuosoRef}
			data={items}
			itemContent={(index, item) => children(item, index)}
			{...(getKey ? { computeItemKey: (index: number, item: T) => getKey(item, index) } : {})}
			{...(scrollerRef ? { scrollerRef } : {})}
			{...(atBottomStateChange ? { atBottomStateChange } : {})}
			{...(itemsRendered ? { itemsRendered } : {})}
			{...(rangeChanged ? { rangeChanged } : {})}
			{...(restoreStateFrom ? { restoreStateFrom } : {})}
			{...(followOutput !== undefined ? { followOutput } : {})}
			{...(initialTopMostItemIndex !== undefined ? { initialTopMostItemIndex } : {})}
			{...(overscan !== undefined ? { overscan } : {})}
			{...(minOverscanItemCount !== undefined ? { minOverscanItemCount } : {})}
			{...(increaseViewportBy !== undefined ? { increaseViewportBy } : {})}
			{...(defaultItemHeight !== undefined ? { defaultItemHeight } : {})}
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
