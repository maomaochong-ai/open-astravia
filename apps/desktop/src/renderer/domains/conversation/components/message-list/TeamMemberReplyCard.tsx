import type { ChatTimelineEventViewModel } from "@shared/store/atoms";
import { AgentAvatarView, LiveThinkingView } from "@vetta/theme-ui/chat";
import { useTranslation } from "react-i18next";

type TeamMemberSummaryEvent = Extract<ChatTimelineEventViewModel, { kind: "team-member-summary" }>;

interface TeamMemberReplyCardProps {
	event: TeamMemberSummaryEvent;
	onOpen: (memberId: string) => void;
}

function stateKey(event: TeamMemberSummaryEvent):
	| "chat.memberActivity.waiting"
	| "chat.memberActivity.processingTool"
	| "chat.memberActivity.thinking"
	| "chat.memberActivity.processing"
	| "chat.memberActivity.waitingReply"
	| "chat.memberActivity.failed"
	| "chat.memberActivity.cancelled"
	| "chat.memberActivity.completed" {
	switch (event.state) {
		case "pending":
			return "chat.memberActivity.waiting";
		case "streaming":
			return event.currentKind === "tool"
				? "chat.memberActivity.processingTool"
				: event.currentKind === "thinking"
					? "chat.memberActivity.thinking"
					: "chat.memberActivity.processing";
		case "waiting":
			return "chat.memberActivity.waitingReply";
		case "failed":
			return "chat.memberActivity.failed";
		case "cancelled":
			return "chat.memberActivity.cancelled";
		case "completed":
			return "chat.memberActivity.completed";
	}
}

function StatusIcon({ state }: { state: TeamMemberSummaryEvent["state"] }): JSX.Element {
	if (state === "completed") {
		return <span className="icon-[solar--check-circle-linear] h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />;
	}
	if (state === "failed" || state === "cancelled") {
		return <span className="icon-[solar--danger-circle-linear] h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />;
	}
	return <span className="icon-[solar--refresh-linear] h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/60" aria-hidden="true" />;
}

export function TeamMemberReplyCard({ event, onOpen }: TeamMemberReplyCardProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const status = t(stateKey(event));
	const primaryActivity =
		event.state === "completed"
			? event.result?.trim() || event.current?.trim()
			: event.current?.trim() || event.result?.trim();
	const activity = primaryActivity || status;
	const openLabel = t("chat.memberActivity.openSession", { name: event.memberName });

	return (
		<div
			data-testid="team-member-reply-card"
			className="flex h-[300px] min-h-[300px] w-full min-w-0 items-start gap-2 overflow-hidden rounded-xl border border-border/40 bg-card/30 px-3 py-3 text-left"
		>
			<AgentAvatarView
				name={event.memberName}
				avatar={event.memberAvatar}
				blueprintId={event.memberBlueprintId ?? "leader"}
				size="xs"
				active={event.state === "streaming" || event.state === "pending"}
			/>
			<span className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
				<span className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-[12px] font-medium text-foreground/80">{event.memberName}</span>
					<StatusIcon state={event.state} />
					<span className="truncate text-[11px] text-muted-foreground/60">{status}</span>
					<button
						type="button"
						className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						aria-label={openLabel}
						title={openLabel}
						onClick={() => onOpen(event.memberId)}
					>
						<span className="icon-[solar--arrow-right-up-linear] h-4 w-4" aria-hidden="true" />
					</button>
				</span>
				<span className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-lg bg-muted/20 px-3 py-2">
					{event.currentKind === "thinking" && event.current ? (
						<span className="min-h-0 overflow-hidden">
						<LiveThinkingView text={event.current} />
						</span>
					) : (
						<span
							className={`min-w-0 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-6 ${event.state === "streaming" ? "tool-call-shimmer-text" : "text-muted-foreground/70"}`}
						>
							{activity}
						</span>
					)}
					{event.recent.length > 0 ? (
						<span className="min-w-0 truncate text-[11px] text-muted-foreground/45">
							{t("chat.memberActivity.recent", { text: event.recent.join(" · ") })}
						</span>
					) : null}
				</span>
			</span>
		</div>
	);
}
