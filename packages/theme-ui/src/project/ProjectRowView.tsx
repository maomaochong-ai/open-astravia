import { cn } from "@vetta/ui";
import type { JSX, Ref } from "react";
import { RunningPulseDot } from "../sidebar/RunningPulseDot";
import { PROJECT_TYPE_ICONS, type ProjectTypeIconKey } from "./types";

export interface ProjectRowViewProps {
	badge?: string;
	displayName: string;
	expanded: boolean;
	hasRunning: boolean;
	isActive: boolean;
	newSessionTitle: string;
	onCollapse: () => void;
	onExpand: () => void;
	onInteract?: () => void;
	onNavigateProject: () => void;
	onNewSession: () => void;
	onOpenContextMenu: (event: React.MouseEvent) => void;
	projectCwd: string;
	projectType: ProjectTypeIconKey;
	rowRef?: Ref<HTMLDivElement>;
}

export function ProjectRowView({
	badge,
	displayName,
	expanded,
	hasRunning,
	isActive,
	newSessionTitle,
	onCollapse,
	onExpand,
	onInteract,
	onNavigateProject,
	onNewSession,
	onOpenContextMenu,
	projectCwd,
	projectType,
	rowRef,
}: ProjectRowViewProps): JSX.Element {
	return (
		<div
			ref={rowRef}
			className={cn(
				"group flex w-full items-center gap-2 rounded-lg px-2.5 py-[6px] text-left transition-colors duration-100",
				isActive ? "bg-accent text-foreground" : "hover:bg-accent/50",
			)}
			title={projectCwd}
			onContextMenu={onOpenContextMenu}
		>
			<button
				type="button"
				onClick={() => {
					onInteract?.();
					if (expanded) {
						onCollapse();
						return;
					}
					onExpand();
					onNavigateProject();
				}}
				className="relative flex shrink-0 items-center justify-center"
			>
				<span
					className={cn(
						expanded ? "icon-[solar--alt-arrow-down-linear]" : PROJECT_TYPE_ICONS[projectType],
						"h-4 w-4 text-foreground",
					)}
				/>
				{hasRunning && <RunningPulseDot />}
			</button>
			<button
				type="button"
				onClick={() => {
					onInteract?.();
					if (!expanded) {
						onExpand();
					}
					onNavigateProject();
				}}
				className={cn(
					"min-w-0 flex-1 truncate text-left text-[13px] font-medium",
					isActive ? "font-semibold text-foreground" : "text-foreground",
				)}
			>
				{displayName}
			</button>
			<div className="relative flex shrink-0 items-center">
				{badge && (
					<span className="rounded-sm bg-accent px-1 py-px text-[10px] text-muted-foreground group-hover:hidden">
						{badge}
					</span>
				)}
				<button
					type="button"
					title={newSessionTitle}
					onClick={(event) => {
						event.stopPropagation();
						onNewSession();
					}}
					className={cn(
						"flex h-[18px] w-[18px] items-center justify-center rounded-[4px] text-foreground hover:bg-accent",
						badge ? "hidden group-hover:flex" : "opacity-0 group-hover:opacity-100",
					)}
				>
					<span className="icon-[solar--add-circle-linear] h-3 w-3" />
				</button>
			</div>
		</div>
	);
}
