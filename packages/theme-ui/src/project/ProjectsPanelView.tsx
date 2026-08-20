import type { JSX, ReactNode } from "react";
import { ScrollFade } from "../shared/ScrollFade";
import { QuickScrollOverlay, type QuickScrollLabels } from "./QuickScrollOverlay";

export interface ProjectsPanelViewProps {
	defaultSection: ReactNode;
	/** Host-resolved empty state (i18n). */
	emptyState: ReactNode;
	menus: ReactNode;
	/** Projects and the default conversation share this single scroll container. */
	onScrollRef: (el: HTMLDivElement | null) => void;
	scrollElement: HTMLElement | null;
	projectsSection: ReactNode;
	quickScrollLabels: QuickScrollLabels;
	showDefaultRegion: boolean;
	showEmpty: boolean;
	showProjectsRegion: boolean;
}

export function ProjectsPanelView({
	defaultSection,
	emptyState,
	menus,
	onScrollRef,
	scrollElement,
	projectsSection,
	quickScrollLabels,
	showDefaultRegion,
	showEmpty,
	showProjectsRegion,
}: ProjectsPanelViewProps): JSX.Element {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden px-1.5 py-0.5">
			{showEmpty ? (
				<div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">{emptyState}</div>
			) : (
				<QuickScrollOverlay
					labels={quickScrollLabels}
					scrollElement={scrollElement}
					className="min-h-0 flex-1"
				>
					<ScrollFade
						data-sidebar-selection-scroll="true"
						onScrollRef={onScrollRef}
						className="min-h-0 flex-1 overflow-y-auto no-scrollbar"
					>
						{showProjectsRegion && <div data-tour="sidebar-projects">{projectsSection}</div>}
						{showDefaultRegion && <div data-tour="sidebar-conversations">{defaultSection}</div>}
					</ScrollFade>
				</QuickScrollOverlay>
			)}

			{menus}
		</div>
	);
}
