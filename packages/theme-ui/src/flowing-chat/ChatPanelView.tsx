import { cn } from "@vetta-org/ui";
import type { JSX, ReactNode, Ref, UIEventHandler } from "react";

export interface ChatPanelViewLabels {
	loadingMore: string;
	noMore: string;
	empty: string;
}

export interface ChatPanelViewProps {
	labels: ChatPanelViewLabels;
	loading: boolean;
	loadingMore: boolean;
	hasMore: boolean;
	isEmpty: boolean;
	scrollerRef: Ref<HTMLDivElement>;
	onScroll: UIEventHandler<HTMLDivElement>;
	membersBar: ReactNode;
	messageList: ReactNode;
	composer: ReactNode;
}

/**
 * Flowing-chat panel shell: members bar + scroll list + composer slots.
 */
export function ChatPanelView({
	labels,
	loading,
	loadingMore,
	hasMore,
	isEmpty,
	scrollerRef,
	onScroll,
	membersBar,
	messageList,
	composer,
}: ChatPanelViewProps): JSX.Element {
	return (
		<div className="flex h-full min-h-0 flex-col bg-gradient-to-b from-background via-background to-muted/20">
			{membersBar}
			<div
				ref={scrollerRef}
				onScroll={onScroll}
				className={cn(
					"flex-1 overflow-y-auto px-4 py-3 transition-opacity duration-200",
					loading && "opacity-0",
				)}
			>
				{loadingMore && (
					<div className="flex items-center justify-center gap-1.5 py-2 text-[10.5px] text-muted-foreground/60">
						<span className="icon-[mdi--loading] h-3 w-3 animate-spin" />
						{labels.loadingMore}
					</div>
				)}
				{!hasMore && !loading && !isEmpty && (
					<div className="py-2 text-center text-[10px] uppercase tracking-wider text-muted-foreground/40">
						{labels.noMore}
					</div>
				)}
				{!loading && isEmpty && (
					<div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground/40">
						<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/40">
							<span className="icon-[mdi--message-text-outline] text-[24px]" />
						</div>
						<span className="text-[12px]">{labels.empty}</span>
					</div>
				)}
				{messageList}
			</div>
			{composer}
		</div>
	);
}
