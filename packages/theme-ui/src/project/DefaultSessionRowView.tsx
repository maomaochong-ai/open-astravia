import { cn } from "@vetta/ui";
import { memo, type JSX } from "react";
import { SessionRenameInputView } from "./SessionRenameInputView";
import { prepareSidebarSelection } from "./useActiveSessionAutoScroll";

export interface DefaultSessionRowViewProps {
	active: boolean;
	/** When false, context menu is ignored (e.g. claw filter). */
	contextMenuEnabled: boolean;
	label: string;
	/** Optional source-specific icon, used by non-session conversation sources such as Agent Teams. */
	iconClassName?: string;
	/** On-disk session path; used for fly-to-sidebar targeting. */
	sessionPath?: string;
	/** Tooltip / secondary label (e.g. forked-from preview). */
	titleExtra?: string;
	/** Session was forked from another session. */
	forked?: boolean;
	onOpenContextMenu: (event: React.MouseEvent) => void;
	onRename: (name: string) => void;
	onRenameDone: () => void;
	onSelect: () => void;
	pinned?: boolean;
	renaming: boolean;
	running: boolean;
	scheduled: boolean;
	timeLabel: string;
}

/** memo：理由同 SessionRowView——切换会话只改两行，其余行 props 未变。 */
export const DefaultSessionRowView = memo(function DefaultSessionRowView({
	active,
	contextMenuEnabled,
	label,
	iconClassName,
	sessionPath,
	titleExtra,
	forked,
	onOpenContextMenu,
	onRename,
	onRenameDone,
	onSelect,
	pinned = false,
	renaming,
	running,
	scheduled,
	timeLabel,
}: DefaultSessionRowViewProps): JSX.Element {
	const title = renaming ? undefined : titleExtra ? `${label}\n${titleExtra}` : label;
	const leadingIconClassName = running
		? "project-running-icon icon-[solar--refresh-linear] animate-spin"
		: scheduled
			? "icon-[solar--clock-circle-linear] text-primary/80"
			: forked
				? "icon-[mdi--source-fork]"
				: pinned
					? "icon-[solar--pin-linear] text-primary/80"
					: iconClassName ?? "icon-[solar--chat-round-line-linear]";
	return (
		<button
			type="button"
			data-session-active={active ? "true" : undefined}
			data-session-path={sessionPath || undefined}
			onClick={(event) => {
				if (renaming) return;
				prepareSidebarSelection(event.currentTarget);
				onSelect();
			}}
			onContextMenu={(event) => {
				event.preventDefault();
				if (!contextMenuEnabled) return;
				onOpenContextMenu(event);
			}}
			className={cn(
				"flex w-full items-center gap-2 rounded-md px-2.5 py-[6px] text-left transition-colors duration-100",
				active ? "bg-primary/15 text-foreground" : "hover:bg-accent/50",
			)}
			title={title}
		>
			{renaming ? (
				<SessionRenameInputView
					initialValue={label}
					onCancel={onRenameDone}
					onCommit={onRename}
				/>
			) : (
				<>
					<span
						data-session-leading-icon="true"
						aria-hidden="true"
						className={cn(
							leadingIconClassName,
							"h-3.5 w-3.5 shrink-0",
							active ? "text-foreground/70" : "text-muted-foreground/50",
						)}
					/>
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-[13px]",
							active ? "font-semibold text-foreground" : "text-foreground",
						)}
					>
						{label}
					</span>
					<span className="shrink-0 text-[11px] text-muted-foreground">{timeLabel}</span>
				</>
			)}
		</button>
	);
});
