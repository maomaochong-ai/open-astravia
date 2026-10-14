import type { JSX } from "react";
import { useState } from "react";
import { AgentAvatarView } from "./AgentAvatarView";
import { LiveThinkingView } from "./LiveThinkingView";

export type TeamMemberReplyState = "pending" | "streaming" | "waiting" | "failed" | "cancelled" | "completed";

export interface TeamMemberReplyCardViewProps {
	readonly memberName: string;
	readonly memberAvatar?: string;
	readonly state: TeamMemberReplyState;
	readonly statusLabel: string;
	readonly durationLabel?: string;
	/** What the member is doing or what it replied; shown when the card is expanded. */
	readonly activity: string;
	/** Live reasoning text; replaces `activity` while the member is thinking. */
	readonly thinking?: string;
	readonly recentLabel?: string;
	readonly openLabel: string;
	/** Opens the member's conversation; without it the card has no open button. */
	readonly onOpen?: () => void;
}

/** 状态徽标：完成 / 失败 用静态图标，进行中用一枚呼吸的圆点，避免整行都在转圈。 */
function StatusBadge({ state, label }: { state: TeamMemberReplyState; label: string }): JSX.Element {
	if (state === "completed") {
		return (
			<span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/25 px-2 py-[2px] text-[10px] font-medium text-emerald-400/90">
				<span className="icon-[solar--check-circle-linear] h-3 w-3" aria-hidden="true" />
				{label}
			</span>
		);
	}
	if (state === "failed" || state === "cancelled") {
		return (
			<span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-destructive/30 px-2 py-[2px] text-[10px] font-medium text-destructive/90">
				<span className="icon-[solar--danger-circle-linear] h-3 w-3" aria-hidden="true" />
				{label}
			</span>
		);
	}
	return (
		<span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/50 px-2 py-[2px] text-[10px] font-medium text-muted-foreground/70">
			<span className="relative flex h-1.5 w-1.5" aria-hidden="true">
				<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
				<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary/80" />
			</span>
			{label}
		</span>
	);
}

/** A Team member's progress and reply, collapsed to one line until expanded. */
export function TeamMemberReplyCardView({
	memberName,
	memberAvatar,
	state,
	statusLabel,
	durationLabel,
	activity,
	thinking,
	recentLabel,
	openLabel,
	onOpen,
}: TeamMemberReplyCardViewProps): JSX.Element {
	// 默认折叠：一次派遣往往牵出多张卡片，先只留身份与状态一行。
	const [expanded, setExpanded] = useState(false);
	const active = state === "streaming" || state === "pending";
	return (
		<div
			data-testid="team-member-reply-card"
			className={`flex w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-secondary text-left dark:bg-input-bar-bg transition-colors ${
				active ? "border-primary/25" : "border-border/40"
			}`}
		>
			<div className="relative flex min-w-0 items-center">
				{/* 抬头整行即折叠开关：热区铺满整行宽度，打开会话按钮浮在其上。 */}
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => setExpanded((open) => !open)}
					className={`flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
						onOpen ? "pr-11" : ""
					}`}
				>
					<AgentAvatarView name={memberName} avatar={memberAvatar} size="lg" active={active} />
					<span className="truncate text-[13px] font-semibold tracking-tight text-foreground/90">{memberName}</span>
					<StatusBadge state={state} label={statusLabel} />
					{durationLabel !== undefined ? (
						<span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55">{durationLabel}</span>
					) : null}
					<span
						className={`icon-[solar--alt-arrow-down-linear] ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/45 transition-transform ${
							expanded ? "rotate-180" : ""
						}`}
						aria-hidden="true"
					/>
				</button>
				{onOpen ? (
					<button
						type="button"
						className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						aria-label={openLabel}
						title={openLabel}
						onClick={onOpen}
					>
						<span className="icon-[solar--arrow-right-up-linear] h-4 w-4" aria-hidden="true" />
					</button>
				) : null}
			</div>
			{expanded ? (
				<div className="flex max-h-[240px] min-h-0 flex-col gap-2 border-t border-border/30 px-3.5 py-3">
					{thinking ? (
						<span className="min-h-0 overflow-y-auto">
							<LiveThinkingView text={thinking} />
						</span>
					) : (
						<span
							className={`min-w-0 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-6 ${state === "streaming" ? "tool-call-shimmer-text" : "text-muted-foreground/75"}`}
						>
							{activity}
						</span>
					)}
					{recentLabel ? (
						<span className="min-w-0 truncate border-t border-border/30 pt-2 text-[11px] text-muted-foreground/45">
							{recentLabel}
						</span>
					) : null}
				</div>
			) : null}
		</div>
	);
}
