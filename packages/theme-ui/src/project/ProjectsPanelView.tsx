import type { CSSProperties, JSX, ReactNode, RefObject } from "react";
import { ScrollFade } from "../shared/ScrollFade";
import { ProjectsPanelSplitHandle } from "../sidebar/ProjectsPanelSplitHandle";
import { QuickScrollOverlay, type QuickScrollLabels } from "./QuickScrollOverlay";

const SPLIT_HANDLE_HEIGHT = 10;
/** Keep the default conversation header, both quick-scroll rails, and two session rows usable. */
const DEFAULT_CONVERSATION_MIN_HEIGHT = 144;

export interface ProjectsPanelViewProps {
	defaultConversationRegionRef?: RefObject<HTMLDivElement | null>;
	defaultSection: ReactNode;
	/** Host-resolved empty state (i18n). */
	emptyState: ReactNode;
	menus: ReactNode;
	onProjectsScrollRef: (el: HTMLDivElement | null) => void;
	projectsScrollElement: HTMLElement | null;
	onSplitResize: (deltaY: number) => void;
	onSplitResizeEnd: () => void;
	onSplitResizeStart: () => void;
	projectsSection: ReactNode;
	/**
	 * When true (and not split), the projects region does not grow — used for
	 * the no-projects empty placeholder above the default conversation section.
	 */
	projectsRegionCompact?: boolean;
	quickScrollLabels: QuickScrollLabels;
	showDefaultRegion: boolean;
	showEmpty: boolean;
	showProjectsRegion: boolean;
	showSplit: boolean;
	splitDragging: boolean;
	splitContainerRef: RefObject<HTMLDivElement | null>;
	splitRatio: number;
}

export function ProjectsPanelView({
	defaultConversationRegionRef,
	defaultSection,
	emptyState,
	menus,
	onProjectsScrollRef,
	projectsScrollElement,
	onSplitResize,
	onSplitResizeEnd,
	onSplitResizeStart,
	projectsSection,
	projectsRegionCompact = false,
	quickScrollLabels,
	showDefaultRegion,
	showEmpty,
	showProjectsRegion,
	showSplit,
	splitDragging,
	splitContainerRef,
	splitRatio,
}: ProjectsPanelViewProps): JSX.Element {
	const projectsScroll = (
		<ScrollFade
			data-tour="sidebar-projects"
			data-sidebar-selection-scroll="true"
			onScrollRef={onProjectsScrollRef}
			className={
				projectsRegionCompact
					? "shrink-0 overflow-y-auto no-scrollbar"
					: "min-h-0 flex-1 overflow-y-auto no-scrollbar"
			}
		>
			{projectsSection}
		</ScrollFade>
	);

	const splitProjectsStyle: CSSProperties = {
		maxHeight: `max(0px, min(calc(${splitRatio * 100}% - ${SPLIT_HANDLE_HEIGHT * splitRatio}px), calc(100% - ${SPLIT_HANDLE_HEIGHT + DEFAULT_CONVERSATION_MIN_HEIGHT}px)))`,
	};

	const conversationRegion = (
		<div
			ref={defaultConversationRegionRef}
			data-tour="sidebar-conversations"
			className="flex min-h-0 flex-1 flex-col overflow-hidden"
		>
			{defaultSection}
		</div>
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden px-1.5 py-0.5">
			{showEmpty && <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">{emptyState}</div>}

			{showSplit ? (
				<div ref={splitContainerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<QuickScrollOverlay
						labels={quickScrollLabels}
						scrollElement={projectsScrollElement}
						className={`min-h-0 shrink-0 motion-reduce:transition-none ${
							splitDragging ? "" : "transition-[max-height] duration-[350ms] ease-out"
						}`}
						style={splitProjectsStyle}
					>
						{projectsScroll}
					</QuickScrollOverlay>
					<ProjectsPanelSplitHandle
						onResize={onSplitResize}
						onResizeEnd={onSplitResizeEnd}
						onResizeStart={onSplitResizeStart}
					/>
					{conversationRegion}
				</div>
			) : (
				<>
					{showProjectsRegion &&
						(projectsRegionCompact ? (
							projectsScroll
						) : (
							<QuickScrollOverlay
								labels={quickScrollLabels}
								scrollElement={projectsScrollElement}
								className="min-h-0 flex-1"
							>
								{projectsScroll}
							</QuickScrollOverlay>
						))}
					{showDefaultRegion && conversationRegion}
				</>
			)}

			{menus}
		</div>
	);
}
