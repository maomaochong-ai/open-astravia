import { useRef, type JSX, type ReactNode } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useDelayedUnmount } from "../shared/useDelayedUnmount";
import { ShowMoreSessionsButton } from "../sidebar/ShowMoreSessionsButton";
import { ProjectSessionsLoadingView } from "./ProjectSessionsLoadingView";
import {
	VIRTUAL_SESSION_OVERSCAN,
	VIRTUAL_SESSION_ROW_HEIGHT,
} from "./types";
import { useActiveSessionAutoScroll } from "./useActiveSessionAutoScroll";

export interface ProjectSessionsViewItem {
	active?: boolean;
	key: string;
}

export interface ProjectSessionsViewLabels {
	collapse: string;
	expand: string;
}

export interface ProjectSessionsViewProps<T extends ProjectSessionsViewItem> {
	empty: ReactNode;
	expanded: boolean;
	hasMore: boolean;
	loading?: boolean;
	labels: ProjectSessionsViewLabels;
	onToggleShowAll: () => void;
	/** Scroll parent for Virtuoso when showAll. */
	scrollParent: HTMLElement | null;
	sessions: readonly T[];
	showAll: boolean;
	renderSession: (session: T) => ReactNode;
}

export function ProjectSessionsView<T extends ProjectSessionsViewItem>({
	empty,
	expanded,
	hasMore,
	loading = false,
	labels,
	onToggleShowAll,
	scrollParent,
	sessions,
	showAll,
	renderSession,
}: ProjectSessionsViewProps<T>): JSX.Element {
	const useVirtual = showAll && sessions.length > 0 && scrollParent != null;
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const activeIndex = sessions.findIndex((session) => session.active);
	const activeKey = activeIndex >= 0 ? sessions[activeIndex]?.key : undefined;
	useActiveSessionAutoScroll({ activeIndex, activeKey, enabled: expanded, scrollParent, virtuosoRef });
	// 纯 CSS grid-rows 过渡替代 motion 的 height:auto 动画：折叠动画播完（200ms）后才卸载
	// 子树，动画期间没有任何逐帧 JS 测量/写高度。
	const renderContent = useDelayedUnmount(expanded, 220);

	return (
		<div
			aria-hidden={!expanded}
			className="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
			style={{ gridTemplateRows: expanded ? "1fr" : "0fr", opacity: expanded ? 1 : 0 }}
		>
			<div className="min-h-0 overflow-hidden">
				{renderContent && (
					<div className="mt-px space-y-px">
						{loading ? (
							<ProjectSessionsLoadingView />
						) : sessions.length === 0 ? (
							empty
						) : useVirtual ? (
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
							sessions.map((session) => renderSession(session))
						)}
						{hasMore && (
							<ShowMoreSessionsButton
								labels={labels}
								onClick={onToggleShowAll}
								showAll={showAll}
							/>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
