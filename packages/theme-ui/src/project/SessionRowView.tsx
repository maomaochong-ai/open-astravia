import { cn } from "@vetta/ui";
import { memo, type JSX } from "react";
import { SessionStatusIcon } from "../sidebar/SessionStatusIcon";
import { AvatarStackView } from "../shared/AvatarStackView";
import { SessionRenameInputView } from "./SessionRenameInputView";
import { prepareSidebarSelection } from "./useActiveSessionAutoScroll";

export interface SessionRowViewProps {
	active: boolean;
	label: string;
	/** Optional source-specific icon, used by non-session conversation sources such as Agent Teams. */
	iconClassName?: string;
	/** Optional grouped-participant context rendered at the trailing edge. */
	trailingAvatarUrls?: readonly string[];
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
}

/**
 * memo：切换会话时只有「上一条」「下一条」两行的 active 变了，其余行的 props 完全一致。
 * 没有 memo 时整份会话列表会跟着重渲染一遍。前提是调用方传的回调引用稳定。
 */
export const SessionRowView = memo(function SessionRowView({
	active,
	label,
	iconClassName,
	trailingAvatarUrls,
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
}: SessionRowViewProps): JSX.Element {
	const title = renaming ? undefined : titleExtra ? `${label}\n${titleExtra}` : label;
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
			onContextMenu={onOpenContextMenu}
			className={cn(
				"relative flex w-full items-center gap-2 rounded-lg py-[6px] pr-2.5 pl-[30px] text-left transition-colors duration-100",
				active ? "bg-accent text-foreground" : "hover:bg-accent/50",
			)}
			title={title}
		>
			{renaming ? (
				<SessionRenameInputView
					className="min-w-0 flex-1 truncate rounded-[3px] border border-input bg-accent/50 pl-[20px] text-[13px] text-foreground outline-none"
					initialValue={label}
					onCancel={onRenameDone}
					onCommit={onRename}
				/>
			) : (
				<>
					{pinned ? (
						<span className="icon-[solar--pin-linear] h-3.5 w-3.5 shrink-0 text-primary/80" />
					) : null}
					{forked && !running && !scheduled ? (
						<span
							data-session-leading-icon="true"
							className={cn(
								"icon-[mdi--source-fork] h-3.5 w-3.5 shrink-0",
								active ? "text-primary/80" : "text-muted-foreground/60",
							)}
						/>
					) : iconClassName && !running && !scheduled ? (
						<span
							data-session-leading-icon="true"
							aria-hidden="true"
							className={cn(
								iconClassName,
								"h-3.5 w-3.5 shrink-0",
								active ? "text-foreground/70" : "text-muted-foreground/50",
							)}
						/>
					) : (
						<SessionStatusIcon active={active} running={running} scheduled={scheduled} />
					)}
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-[13px]",
							running && "pl-1",
							active ? "font-semibold text-foreground" : "text-foreground",
						)}
					>
						{label}
					</span>
					{trailingAvatarUrls && trailingAvatarUrls.length > 0 ? (
						<AvatarStackView avatarUrls={trailingAvatarUrls} />
					) : null}
				</>
			)}
		</button>
	);
});
