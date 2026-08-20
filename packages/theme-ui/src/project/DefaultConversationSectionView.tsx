import { cn } from "@vetta/ui";
import type { JSX, ReactNode } from "react";

export interface DefaultConversationSectionViewLabels {
	more: string;
	newSession: string;
}

export interface DefaultConversationSectionViewProps {
	className?: string;
	filterSelect: ReactNode;
	labels: DefaultConversationSectionViewLabels;
	list: ReactNode;
	onMoreClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
	onNewSession?: () => void;
	onOpenContextMenu: (event: React.MouseEvent) => void;
	showNewSession: boolean;
	/**
	 * When the conversation list is empty, keep header actions visible so users
	 * can discover “new session” without hovering the row.
	 */
	actionsAlwaysVisible?: boolean;
}

/**
 * 该区块不再自带滚动容器：项目区与对话区共用侧栏面板的同一个滚动区。
 */
export function DefaultConversationSectionView({
	className,
	filterSelect,
	labels,
	list,
	onMoreClick,
	onNewSession,
	onOpenContextMenu,
	showNewSession,
	actionsAlwaysVisible = false,
}: DefaultConversationSectionViewProps): JSX.Element {
	const actionButtonClass = actionsAlwaysVisible
		? "flex items-center justify-center rounded-md p-1.5 text-foreground opacity-70 transition-opacity hover:bg-accent hover:opacity-100"
		: "flex items-center justify-center rounded-md p-1.5 text-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-60 group-hover:hover:opacity-100";

	return (
		<div className={cn("flex flex-col", className)}>
			<div
				className="group -mx-1.5 flex shrink-0 items-center justify-between pb-1 pl-2 pr-1 pt-1"
				onContextMenu={onOpenContextMenu}
			>
				<div className="flex min-w-0 items-center gap-0.5">{filterSelect}</div>
				<div className="flex items-center">
					<button
						type="button"
						title={labels.more}
						onClick={onMoreClick}
						className={actionButtonClass}
					>
						<span className="icon-[solar--menu-dots-linear] h-4 w-4" />
					</button>
					{showNewSession && onNewSession && (
						<button
							type="button"
							title={labels.newSession}
							onClick={onNewSession}
							className={actionButtonClass}
						>
							<span className="icon-[solar--add-square-outline] h-4 w-4" />
						</button>
					)}
				</div>
			</div>
			{list}
		</div>
	);
}
