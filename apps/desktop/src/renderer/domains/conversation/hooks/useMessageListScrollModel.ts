import {
	type MessageFeedScrollModel,
	useMessageFeedScrollModel,
} from "@shared/components/message-feed/useMessageFeedScrollModel";
import { activityPanelResizingAtom, type ChatConversationItem } from "@shared/store/atoms";
import { useAtomValue } from "jotai";

interface MessageListScrollModelInput {
	isStreaming: boolean;
	messages: readonly ChatConversationItem[];
	sessionId?: string | null;
	initialTargetKey?: string | null;
	onInitialTargetHandled?: () => void;
}

export interface MessageListScrollModel extends Omit<MessageFeedScrollModel, "scrollToItem"> {
	scrollToMessage: (index: number) => void;
}

const getMessageKey = (message: ChatConversationItem): string => message.entryId ?? message.id;
const shouldFollowUserMessage = (message: ChatConversationItem): boolean => message.kind === "user";

/** Chat adapter for the shared feed viewport controller. */
export function useMessageListScrollModel({
	isStreaming,
	messages,
	sessionId,
	initialTargetKey,
	onInitialTargetHandled,
}: MessageListScrollModelInput): MessageListScrollModel {
	const activityPanelResizing = useAtomValue(activityPanelResizingAtom);
	const feed = useMessageFeedScrollModel({
		active: isStreaming,
		items: messages,
		resetKey: sessionId,
		layoutResizing: activityPanelResizing,
		initialTargetKey,
		getItemKey: getMessageKey,
		onInitialTargetHandled,
		shouldFollowOnAppend: shouldFollowUserMessage,
	});
	return {
		onAtBottomChange: feed.onAtBottomChange,
		scrollerElement: feed.scrollerElement,
		scrollerRef: feed.scrollerRef,
		scrollToMessage: feed.scrollToItem,
		virtuosoRef: feed.virtuosoRef,
		restoreStateFrom: feed.restoreStateFrom,
	};
}
