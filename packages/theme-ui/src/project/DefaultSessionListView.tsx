import { cn } from "@vetta-org/ui";
import { useRef, type JSX, type ReactNode } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
	VIRTUAL_SESSION_OVERSCAN,
	VIRTUAL_SESSION_ROW_HEIGHT,
} from "./types";
import { useActiveSessionAutoScroll } from "./useActiveSessionAutoScroll";
import { ProjectSessionsLoadingView } from "./ProjectSessionsLoadingView";

export interface DefaultSessionListViewItem {
	active?: boolean;
	key: string;
}

export interface DefaultSessionListViewLabels {
	collapse: string;
	expand: string;
	/** Accessible name for each row's hover "more" trigger. */
	more: string;
	/** Primary empty-state line. */
	emptyTitle: string;
	/** Guidance under the title. */
	emptyDescription: string;
	/** Optional CTA label; omit when no action (e.g. Claw filter). */
	emptyAction?: string;
}

export interface DefaultSessionListViewProps<T extends DefaultSessionListViewItem> {
	className?: string;
	hasMore: boolean;
	labels: DefaultSessionListViewLabels;
	loading?: boolean;
	onEmptyAction?: () => void;
	onToggleShowAll: () => void;
	renderSession: (session: T) => ReactNode;
	scrollParent: HTMLElement | null;
	sessions: readonly T[];
	/** Full sorted list length for empty check; visible list may be sliced. */
	showAll: boolean;
	totalCount: number;
	visibleSessions: readonly T[];
}

export function DefaultSessionListView<T extends DefaultSessionListViewItem>({
	className,
	hasMore,
	labels,
	loading = false,
	onEmptyAction,
	onToggleShowAll,
	renderSession,
	scrollParent,
	sessions,
	showAll,
	totalCount,
	visibleSessions,
}: DefaultSessionListViewProps<T>): JSX.Element {
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const activeIndex = sessions.findIndex((session) => session.active);
	const activeKey = activeIndex >= 0 ? sessions[activeIndex]?.key : undefined;
	useActiveSessionAutoScroll({ activeIndex, activeKey, scrollParent, virtuosoRef });
	if (loading) return <ProjectSessionsLoadingView />;

	if (totalCount === 0) {
		const showAction = Boolean(labels.emptyAction && onEmptyAction);
		return (
			<div
				className={cn(
					"flex flex-col items-center gap-2.5 px-3 py-8 text-center",
					className,
				)}
			>
				<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/60">
					<span className="icon-[solar--chat-round-line-linear] h-5 w-5 text-muted-foreground/70" />
				</div>
				<div className="flex flex-col gap-1">
					<p className="text-[12px] font-medium text-foreground/80">{labels.emptyTitle}</p>
					<p className="text-[11px] leading-relaxed text-muted-foreground">{labels.emptyDescription}</p>
				</div>
				{showAction && (
					<button
						type="button"
						onClick={onEmptyAction}
						className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
					>
						<span className="icon-[solar--add-circle-linear] h-3.5 w-3.5 shrink-0" />
						{labels.emptyAction}
					</button>
				)}
			</div>
		);
	}

	const useVirtual = showAll && scrollParent != null;

	return (
		<div className={cn("flex flex-col", className)}>
			{useVirtual ? (
				<Virtuoso
					ref={virtuosoRef}
					customScrollParent={scrollParent}
					data={sessions as T[]}
					defaultItemHeight={VIRTUAL_SESSION_ROW_HEIGHT}
					overscan={VIRTUAL_SESSION_OVERSCAN}
					itemContent={(_, session) => (
						<div className="pb-px">{renderSession(session)}</div>
					)}
				/>
			) : (
				<div className="space-y-px">{visibleSessions.map(renderSession)}</div>
			)}
			{hasMore && (
				<button
					type="button"
					onClick={onToggleShowAll}
					className="flex w-full items-center gap-1 rounded-md px-2.5 py-[6px] text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
				>
					<span
						className={cn(
							showAll ? "icon-[solar--alt-arrow-up-linear]" : "icon-[solar--alt-arrow-down-linear]",
							"h-3.5 w-3.5 shrink-0",
						)}
					/>
					{showAll ? labels.collapse : labels.expand}
				</button>
			)}
		</div>
	);
}
