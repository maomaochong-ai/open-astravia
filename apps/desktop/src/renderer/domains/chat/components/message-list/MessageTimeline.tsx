import { MessageFeedNavigationRecipe } from "@shared/components/message-feed/MessageFeedNavigationRecipe";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
	buildMessageNavigationTurns,
	MESSAGE_NAVIGATION_MIN_TURNS,
} from "./messageNavigationModel";
import type { ChatConversationItem } from "./types";

export function MessageTimeline({
	activeMessageIndex,
	messages,
	onNavigate,
}: {
	activeMessageIndex: number;
	messages: ChatConversationItem[];
	onNavigate: (messageIndex: number) => void;
}): JSX.Element | null {
	const { t } = useTranslation("chat");
	const turns = useMemo(() => buildMessageNavigationTurns(messages), [messages]);
	const labels = useMemo(
		() => ({
			open: t("messageList.navigation.open"),
			title: t("messageList.navigation.title"),
			count: (count: number) => t("messageList.navigation.count", { count }),
			noResults: t("messageList.navigation.noResults"),
			close: t("messageList.navigation.close"),
			searchPlaceholder: t("messageList.navigation.searchPlaceholder"),
			searchLabel: t("messageList.navigation.searchLabel"),
			jumpTo: (preview: string) => t("messageList.navigation.jumpTo", { preview }),
			emptyRequest: t("messageList.navigation.emptyUser"),
		}),
		[t],
	);
	if (turns.length < MESSAGE_NAVIGATION_MIN_TURNS) return null;
	return (
		<MessageFeedNavigationRecipe
			activeItemIndex={activeMessageIndex}
			turns={turns}
			onNavigate={onNavigate}
			labels={labels}
		/>
	);
}
