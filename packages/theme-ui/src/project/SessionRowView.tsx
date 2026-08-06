import { cn } from "@vetta/ui";
import { memo, type JSX } from "react";
import { SessionStatusIcon } from "../sidebar/SessionStatusIcon";
import { SessionRenameInputView } from "./SessionRenameInputView";
import { prepareSidebarSelection } from "./useActiveSessionAutoScroll";

export interface SessionRowViewProps {
	active: boolean;
	label: string;
	/** On-disk session path; used for fly-to-sidebar targeting. */
	sessionPath?: string;
	/** Tooltip / secondary label (e.g. forked-from preview). */
	titleExtra?: string;
	/** Session was forked from another session. */
	forked?: boolean;
	onBeforeSelect?: () => void;
	onOpenContextMenu: (event: React.MouseEvent) => void;
	onRename: (name: string) => void;
	onRenameDone: () => void;
	onSelect: () => void;
	renaming: boolean;
	running: boolean;
	scheduled: boolean;
	timeLabel: string;
}

/**
 * memo：切换会话时只有「上一条」「下一条」两行的 active 变了，其余行的 props 完全一致。
 * 没有 memo 时整份会话列表会跟着重渲染一遍。前提是调用方传的回调引用稳定。
 */
export const SessionRowView = memo(function SessionRowView({
	active,
	label,
	sessionPath,
	titleExtra,
	forked,
	onBeforeSelect,
	onOpenContextMenu,
	onRename,
	onRenameDone,
	onSelect,
	renaming,
	running,
	scheduled,
	timeLabel,
}: SessionRowViewProps): JSX.Element {
	const title = renaming ? undefined : titleExtra ? `${label}\n${titleExtra}` : label;
	return (
		<button
			type="button"
			data-session-active={active ? "true" : undefined}
			data-session-path={sessionPath || undefined}
			onClick={(event) => {
				if (renaming) return;
				onBeforeSelect?.();
				prepareSidebarSelection(event.currentTarget);
				onSelect();
			}}
			onContextMenu={onOpenContextMenu}
			className={cn(
				"relative flex w-full items-center gap-2 rounded-lg px-2.5 py-[6px] text-left transition-colors duration-100",
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
					{forked && !running && !scheduled ? (
						<span
							className={cn(
								"icon-[mdi--source-fork] h-3.5 w-3.5 shrink-0",
								active ? "text-primary/80" : "text-muted-foreground/60",
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
				</>
			)}
			<span className="shrink-0 text-[11px] text-muted-foreground">{timeLabel}</span>
		</button>
	);
});
