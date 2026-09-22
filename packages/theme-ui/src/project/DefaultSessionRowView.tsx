import { cn } from "@vetta-org/ui";
import { memo, type JSX } from "react";
import { AvatarStackView } from "../shared/AvatarStackView";
import { ConversationTagDotsView } from "./ConversationTagDotsView";
import { IMMEDIATE_SESSION_SELECTION_STYLE } from "./session-row-transition";
import { SessionRenameInputView } from "./SessionRenameInputView";
import {
	SESSION_ROW_CONTENT_FADE_CLASS,
	SessionRowMoreButton,
} from "./SessionRowMoreButton";
import { prepareSidebarSelection } from "./useActiveSessionAutoScroll";

export interface DefaultSessionRowViewProps {
	active: boolean;
	/** When false, context menu is ignored (e.g. claw filter). */
	contextMenuEnabled: boolean;
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
	/** Tag colors carried by this conversation; replaces the leading icon when present. */
	tagColors?: readonly string[];
	/** Accessible name for the hover "more" trigger. */
	moreLabel?: string;
	onOpenContextMenu: (event: React.MouseEvent) => void;
	onRename: (name: string) => void;
	onRenameDone: () => void;
	onSelect: () => void;
	pinned?: boolean;
	renaming: boolean;
	running: boolean;
	scheduled: boolean;
	/** 自动化会话组组头：本组运行次数。存在时整行点击即展开/收起，不提供更多菜单。 */
	groupCount?: number;
	groupExpanded?: boolean;
	/** 会话组展开后的组员行，缩进一级。 */
	nested?: boolean;
}

/** memo：理由同 SessionRowView——切换会话只改两行，其余行 props 未变。 */
export const DefaultSessionRowView = memo(function DefaultSessionRowView({
	active,
	contextMenuEnabled,
	label,
	iconClassName,
	trailingAvatarUrls,
	sessionPath,
	titleExtra,
	forked,
	moreLabel,
	onOpenContextMenu,
	onRename,
	onRenameDone,
	onSelect,
	pinned = false,
	renaming,
	running,
	scheduled,
	groupCount,
	groupExpanded,
	nested = false,
	tagColors,
}: DefaultSessionRowViewProps): JSX.Element {
	const title = renaming ? undefined : titleExtra ? `${label}\n${titleExtra}` : label;
	// 标签色点让位于「正在运行 / 已排期」这类瞬时状态——那两个是需要立刻读到的信号，
	// 标签则是长期归属，挤掉钉住/分叉图标即可。
	const showTagDots = !running && !scheduled && tagColors !== undefined && tagColors.length > 0;
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
		<div className="group/session-row relative">
			<button
				type="button"
				data-session-active={active ? "true" : undefined}
				aria-expanded={groupCount !== undefined ? groupExpanded === true : undefined}
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
					"flex w-full items-center gap-2 rounded-md py-[6px] pr-2.5 text-left",
					nested ? "pl-7" : "pl-2.5",
					active ? "bg-primary/15 text-foreground" : "hover:bg-accent/50",
				)}
				style={IMMEDIATE_SESSION_SELECTION_STYLE}
				title={title}
			>
				{renaming ? (
					<SessionRenameInputView
						initialValue={label}
						onCancel={onRenameDone}
						onCommit={onRename}
					/>
				) : (
					<div
						className={cn(
							"flex min-w-0 flex-1 items-center gap-2",
							SESSION_ROW_CONTENT_FADE_CLASS,
						)}
					>
						{showTagDots ? (
							<ConversationTagDotsView colors={tagColors} />
						) : (
							<span
								data-session-leading-icon="true"
								aria-hidden="true"
								className={cn(
									leadingIconClassName,
									"h-3.5 w-3.5 shrink-0",
									active ? "text-foreground/70" : "text-muted-foreground/50",
								)}
							/>
						)}
						<span
							className={cn(
								"min-w-0 flex-1 truncate text-[13px]",
								active ? "font-semibold text-foreground" : "text-foreground",
							)}
						>
							{label}
						</span>
						{trailingAvatarUrls && trailingAvatarUrls.length > 0 ? (
							<AvatarStackView avatarUrls={trailingAvatarUrls} />
						) : null}
						{groupCount !== undefined ? (
							<>
								<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">{groupCount}</span>
								<span
									aria-hidden="true"
									className={cn(
										"icon-[mdi--chevron-right] h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform",
										groupExpanded && "rotate-90",
									)}
								/>
							</>
						) : null}
					</div>
				)}
			</button>
			{renaming || !contextMenuEnabled || groupCount !== undefined ? null : (
				<SessionRowMoreButton
					className="rounded-r-md"
					label={moreLabel}
					onOpen={onOpenContextMenu}
				/>
			)}
		</div>
	);
});
