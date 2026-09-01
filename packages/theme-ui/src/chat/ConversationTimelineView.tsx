import { cn } from "@vetta/ui";
import type { CSSProperties, JSX, ReactNode, Ref } from "react";
import { useMemo } from "react";
import {
	type FollowOutput,
	type Components,
	type ListItem,
	type ListRange,
	Virtuoso,
	type VirtuosoHandle,
} from "react-virtuoso";
import { VirtuosoListContainer } from "./MessageListView";

export interface ConversationTimelineViewProps<T> {
	readonly items: readonly T[];
	readonly renderItem: (index: number, item: T) => ReactNode;
	readonly computeItemKey?: (index: number, item: T) => string | number;
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
	readonly footer?: Components<T>["Footer"];
	readonly list?: Components<T>["List"];
	readonly className?: string;
	readonly style?: CSSProperties;
}

/** Shared virtualized timeline viewport. Item semantics and rendering stay in the host adapter. */
export function ConversationTimelineView<T>({
	items,
	renderItem,
	computeItemKey,
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
	footer,
	list = VirtuosoListContainer,
	className,
	style,
}: ConversationTimelineViewProps<T>): JSX.Element {
	const components = useMemo<Components<T>>(
		() => ({ List: list, ...(footer ? { Footer: footer } : {}) }),
		[list, footer],
	);
	return (
		<div className={cn("@container relative flex min-h-0 flex-1 flex-col", className)}>
			<Virtuoso
				ref={virtuosoRef}
				data={[...items]}
				itemContent={renderItem}
				computeItemKey={computeItemKey}
				scrollerRef={scrollerRef}
				atBottomStateChange={atBottomStateChange}
				itemsRendered={itemsRendered}
				rangeChanged={rangeChanged}
				followOutput={followOutput}
				initialTopMostItemIndex={initialTopMostItemIndex}
				overscan={overscan}
				increaseViewportBy={increaseViewportBy}
				defaultItemHeight={defaultItemHeight}
				atBottomThreshold={atBottomThreshold}
				components={components}
				className="flex-1 pt-2"
				style={{ overflowX: "hidden", ...style }}
			/>
		</div>
	);
}
