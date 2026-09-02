import {
	type MessageFeedScrollModel,
	useMessageFeedScrollModel,
} from "@shared/components/message-feed/useMessageFeedScrollModel";
import { activityPanelResizingAtom, type ChatMessage, pendingScrollToEntryAtom } from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

interface MessageListScrollModelInput {
	isStreaming: boolean;
	messages: ChatMessage[];
	sessionId?: string | null;
}

export interface MessageListScrollModel extends Omit<MessageFeedScrollModel, "scrollToItem"> {
	scrollToMessage: (index: number) => void;
}

const getMessageKey = (message: ChatMessage): string => message.entryId ?? message.id;
const shouldFollowUserMessage = (message: ChatMessage): boolean => message.role === "user";

/** Chat adapter for the shared feed viewport controller. */
export function useMessageListScrollModel({
	isStreaming,
	messages,
	sessionId,
}: MessageListScrollModelInput): MessageListScrollModel {
	const activityPanelResizing = useAtomValue(activityPanelResizingAtom);
	const pendingTarget = useAtomValue(pendingScrollToEntryAtom)?.entryId ?? null;
	const setPendingTarget = useSetAtom(pendingScrollToEntryAtom);
	const clearPendingTarget = useCallback(() => setPendingTarget(null), [setPendingTarget]);
	const feed = useMessageFeedScrollModel({
		active: isStreaming,
		items: messages,
		resetKey: sessionId,
		layoutResizing: activityPanelResizing,
		initialTargetKey: pendingTarget,
		getItemKey: getMessageKey,
		onInitialTargetHandled: clearPendingTarget,
		shouldFollowOnAppend: shouldFollowUserMessage,
	});
	return {
		onAtBottomChange: feed.onAtBottomChange,
		scrollerElement: feed.scrollerElement,
		scrollerRef: feed.scrollerRef,
		scrollToMessage: feed.scrollToItem,
		virtuosoRef: feed.virtuosoRef,
	};
}
