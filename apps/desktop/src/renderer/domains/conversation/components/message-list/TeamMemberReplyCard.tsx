import type { ChatTimelineEventViewModel } from "@shared/store/atoms";
import { TeamMemberReplyCardView } from "@vetta-org/theme-ui/chat";
import { useTranslation } from "react-i18next";
import { formatTurnDuration } from "./turnDuration";

type TeamMemberSummaryEvent = Extract<ChatTimelineEventViewModel, { kind: "team-member-summary" }>;

interface TeamMemberReplyCardProps {
	event: TeamMemberSummaryEvent;
	onOpen?: (memberId: string) => void;
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

export function TeamMemberReplyCard({ event, onOpen }: TeamMemberReplyCardProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const { t: tChat } = useTranslation("chat");
	const status = t(stateKey(event));
	const primaryActivity =
		event.state === "completed"
			? event.result?.trim() || event.current?.trim()
			: event.current?.trim() || event.result?.trim();
	return (
		<TeamMemberReplyCardView
			memberName={event.memberName}
			memberAvatar={event.memberAvatar}
			state={event.state}
			statusLabel={status}
			{...(event.durationSeconds !== undefined
				? { durationLabel: formatTurnDuration(event.durationSeconds, tChat) }
				: {})}
			activity={primaryActivity || status}
			{...(event.currentKind === "thinking" && event.current ? { thinking: event.current } : {})}
			{...(event.recent.length > 0
				? { recentLabel: t("chat.memberActivity.recent", { text: event.recent.join(" · ") }) }
				: {})}
			openLabel={t("chat.memberActivity.openSession", { name: event.memberName })}
			{...(onOpen ? { onOpen: () => onOpen(event.memberId) } : {})}
		/>
	);
}
