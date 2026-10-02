import type { ConversationParticipantViewModel } from "@shared/conversation";
import type { ChatAgentMessageViewModel } from "@shared/store/atoms";
import type { Usage } from "@vetta/ai/protocol";
import { StreamingIndicator as ThemeStreamingIndicator } from "@vetta-org/theme-ui/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { AgentMessageBody, AgentMessageProvider } from "../../conversation-view/agent-message";

/** Desktop wrapper: injects i18n streaming phrases into theme-ui indicator. */
export function StreamingIndicator(): JSX.Element {
	const { t } = useTranslation("chat");
	const phrases = t("messageList.streamingPhrases", { returnObjects: true });
	const list = Array.isArray(phrases) ? (phrases as string[]) : [];
	return <ThemeStreamingIndicator phrases={list} />;
}

interface AssistantMessageProps {
	exportMode?: boolean;
	isStreaming: boolean;
	isTailMessage: boolean;
	message: ChatAgentMessageViewModel;
	onTeamMemberOpen?: (memberId: string) => void;
	pendingLabel?: string;
	participant?: ConversationParticipantViewModel;
	sessionUsages?: readonly Usage[];
}

/**
 * The standard reply layout from explicit props, for renderings outside a
 * conversation feed (export). Conversations compose `AgentMessage.*` parts.
 */
export const AssistantMessage = memo(function AssistantMessage({
	message,
	isTailMessage,
	isStreaming,
	pendingLabel,
	onTeamMemberOpen,
	exportMode = false,
	participant,
	sessionUsages,
}: AssistantMessageProps) {
	return (
		<AgentMessageProvider
			input={{
				message,
				isTail: isTailMessage,
				isStreaming,
				exportMode,
				...(pendingLabel ? { pendingLabel } : {}),
				...(participant ? { participant } : {}),
				...(sessionUsages ? { sessionUsages } : {}),
				...(onTeamMemberOpen ? { openTeamMember: onTeamMemberOpen } : {}),
			}}
		>
			<AgentMessageBody />
		</AgentMessageProvider>
	);
});
