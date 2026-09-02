import { cn } from "@vetta/ui";
import { Slot } from "radix-ui";
import type {
	ComponentPropsWithoutRef,
	JSX,
	ReactElement,
	ReactNode,
	Ref,
} from "react";
import { createContext, forwardRef, isValidElement, useContext, useMemo } from "react";
import {
	type Components,
	type FollowOutput,
	type ListItem,
	type ListRange,
	Virtuoso,
	type VirtuosoHandle,
} from "react-virtuoso";
import { MessageFeedProvider, useMessageFeedContext } from "./MessageFeedContext";
import {
	MessageFeedLayoutList,
	type MessageFeedListLayoutProps,
} from "./MessageFeedLayoutView";

const MessageFeedVirtualFooterContext = createContext<ReactNode>(null);
const MessageFeedVirtualListLayoutContext = createContext<
	ReactElement<MessageFeedListLayoutProps> | null
>(null);

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

export const MessageFeedFooter = forwardRef<HTMLDivElement, MessageFeedPrimitiveProps>(
	function MessageFeedFooter(
		{ asChild = false, children, className, ...props },
		forwardedRef,
	) {
		useMessageFeedContext("MessageFeed.Footer");
		const Comp = asChild ? Slot.Root : "div";
		return (
			<Comp
				ref={forwardedRef}
				className={cn(className)}
				data-message-feed-part="footer"
				{...props}
			>
				{children}
			</Comp>
		);
	},
);

export interface MessageFeedVirtualListProps<T>
	extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
	readonly items: readonly T[];
	readonly children:
		| MessageFeedVirtualListChild<T>
		| readonly MessageFeedVirtualListChild<T>[];
	readonly getKey?: (item: T, index: number) => string | number;
	readonly virtuosoRef?: Ref<VirtuosoHandle>;
	readonly scrollerRef?: (ref: HTMLElement | Window | null) => void;
	readonly atBottomStateChange?: (atBottom: boolean) => void;
	readonly itemsRendered?: (items: ListItem<T>[]) => void;
	readonly rangeChanged?: (range: ListRange) => void;
	readonly followOutput?: FollowOutput;
	readonly initialTopMostItemIndex?: number;
	readonly overscan?: number | { main: number; reverse: number };
	readonly increaseViewportBy?: number | { readonly top: number; readonly bottom: number };
	readonly defaultItemHeight?: number;
	readonly atBottomThreshold?: number;
}

export type MessageFeedVirtualListChild<T> =
	| ((item: T, index: number) => ReactNode)
	| ReactElement<MessageFeedPrimitiveProps | MessageFeedListLayoutProps>
	| null
	| false;

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
	followOutput,
	initialTopMostItemIndex,
	overscan,
	increaseViewportBy,
	defaultItemHeight,
	atBottomThreshold,
	className,
	style,
	...hostProps
}: MessageFeedVirtualListProps<T>): JSX.Element {
	useMessageFeedContext("MessageFeed.VirtualList");
	const { renderItem, footer, listLayout } = resolveVirtualListChildren(children);
	const components = useMemo<Components<T>>(
		() => ({
			List: MessageFeedVirtualListSlot,
			...(footer ? { Footer: MessageFeedVirtualFooterSlot } : {}),
		}),
		[footer],
	);
	return (
		<MessageFeedVirtualListLayoutContext.Provider value={listLayout}>
			<MessageFeedVirtualFooterContext.Provider value={footer}>
				<Virtuoso
					{...hostProps}
					ref={virtuosoRef}
					data={items}
					itemContent={(index, item) => renderItem(item, index)}
					{...(getKey ? { computeItemKey: (index: number, item: T) => getKey(item, index) } : {})}
					{...(scrollerRef ? { scrollerRef } : {})}
					{...(atBottomStateChange ? { atBottomStateChange } : {})}
					{...(itemsRendered ? { itemsRendered } : {})}
					{...(rangeChanged ? { rangeChanged } : {})}
					{...(followOutput !== undefined ? { followOutput } : {})}
					{...(initialTopMostItemIndex !== undefined ? { initialTopMostItemIndex } : {})}
					{...(overscan !== undefined ? { overscan } : {})}
					{...(increaseViewportBy !== undefined ? { increaseViewportBy } : {})}
					{...(defaultItemHeight !== undefined ? { defaultItemHeight } : {})}
					{...(atBottomThreshold !== undefined ? { atBottomThreshold } : {})}
					components={components}
					className={cn(className)}
					style={style}
				/>
			</MessageFeedVirtualFooterContext.Provider>
		</MessageFeedVirtualListLayoutContext.Provider>
	);
}

function MessageFeedVirtualFooterSlot(): JSX.Element | null {
	const footer = useContext(MessageFeedVirtualFooterContext);
	return footer ? <>{footer}</> : null;
}

const MessageFeedVirtualListSlot = forwardRef<
	HTMLDivElement,
	ComponentPropsWithoutRef<"div">
>(function MessageFeedVirtualListSlot({ className, style, ...props }, forwardedRef) {
	const listLayout = useContext(MessageFeedVirtualListLayoutContext);
	if (!listLayout) {
		throw new Error("MessageFeed.VirtualList requires one MessageFeedLayout.List child");
	}
	return (
		<MessageFeedLayoutList
			{...props}
			ref={forwardedRef}
			className={cn(listLayout.props.className, className)}
			style={{ ...listLayout.props.style, ...style }}
		/>
	);
});

function resolveVirtualListChildren<T>(children: MessageFeedVirtualListProps<T>["children"]): {
	readonly renderItem: (item: T, index: number) => ReactNode;
	readonly footer: ReactElement<MessageFeedPrimitiveProps> | null;
	readonly listLayout: ReactElement<MessageFeedListLayoutProps> | null;
} {
	let renderItem: ((item: T, index: number) => ReactNode) | undefined;
	let footer: ReactElement<MessageFeedPrimitiveProps> | null = null;
	let listLayout: ReactElement<MessageFeedListLayoutProps> | null = null;
	const visit = (
		child: MessageFeedVirtualListChild<T> | readonly MessageFeedVirtualListChild<T>[],
	): void => {
		if (Array.isArray(child)) {
			for (const nested of child) visit(nested);
			return;
		}
		if (typeof child === "function") {
			if (renderItem) throw new Error("MessageFeed.VirtualList accepts one item renderer");
			renderItem = child;
			return;
		}
		if (child == null || child === false) return;
		if (isValidElement<MessageFeedPrimitiveProps>(child) && child.type === MessageFeedFooter) {
			if (footer) throw new Error("MessageFeed.VirtualList accepts one MessageFeed.Footer");
			footer = child;
			return;
		}
		if (
			isValidElement<MessageFeedListLayoutProps>(child) &&
			child.type === MessageFeedLayoutList
		) {
			if (listLayout) {
				throw new Error("MessageFeed.VirtualList accepts one MessageFeedLayout.List");
			}
			listLayout = child;
			return;
		}
		throw new Error(
			"MessageFeed.VirtualList children must be an item renderer, MessageFeed.Footer, or MessageFeedLayout.List",
		);
	};
	visit(children);
	if (!renderItem) throw new Error("MessageFeed.VirtualList requires an item renderer child");
	if (!listLayout) {
		throw new Error("MessageFeed.VirtualList requires one MessageFeedLayout.List child");
	}
	return { renderItem, footer, listLayout };
}

export const MessageFeed = {
	Root: MessageFeedRoot,
	VirtualList: MessageFeedVirtualList,
	Footer: MessageFeedFooter,
} as const;
