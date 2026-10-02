import { useMessageFeedActiveItem } from "@shared/components/message-feed/useMessageFeedActiveItem";
import {
	perfMessageScrollAttach,
	perfMessageScrollEnabled,
	perfMessageScrollRecordRenderedItems,
} from "@shared/lib/perf-message-scroll";
import type { ChatConversationItem } from "@shared/store/chat-atoms";
import { MessageFeed, MessageFeedLayout } from "@vetta-org/theme-ui/chat";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from "react";
import type { ListItem } from "react-virtuoso";
import type { MessageListModel } from "../components/message-list/types";

/** Everything the viewport parts render from; parts never read the feed or global state. */
export interface ConversationViewportModel extends MessageListModel {
	/** Scope of view state; switching it resets measurements, scroll position and the timeline. */
	readonly feedKey: string | null;
	/** Non-critical derivations (timeline, full usage totals) are ready. */
	readonly deferredContentReady: boolean;
	readonly pendingLabel?: string;
	readonly onAbort?: () => void;
}

interface ConversationViewportState {
	readonly model: ConversationViewportModel;
	readonly activeIndex: number;
	readonly onItemsRendered: (items: ListItem<ChatConversationItem>[]) => void;
}

const ConversationViewportContext = createContext<ConversationViewportState | null>(null);

export function useConversationViewport(part = "Conversation viewport part"): ConversationViewportState {
	const state = useContext(ConversationViewportContext);
	if (!state) throw new Error(`${part} must be rendered inside <Conversation.Viewport>`);
	return state;
}

/**
 * The scrollable frame and the UI-only state its parts share (which message is
 * in view). It renders from a prepared model, so it can be composed and tested
 * without a feed.
 */
export function ConversationViewportFrame({
	model,
	children,
}: {
	readonly model: ConversationViewportModel;
	readonly children: ReactNode;
}) {
	const scrollerElement = model.scroll.scrollerElement;
	const diagnosticsEnabled = perfMessageScrollEnabled();
	const activeItem = useMessageFeedActiveItem<ChatConversationItem>({
		scrollerElement,
		resetKey: model.feedKey,
		initialIndex: Math.max(0, model.messages.length - 1),
	});
	useEffect(() => {
		if (!diagnosticsEnabled || !scrollerElement) return;
		return perfMessageScrollAttach(scrollerElement);
	}, [diagnosticsEnabled, scrollerElement]);
	const onItemsRendered = useCallback(
		(items: ListItem<ChatConversationItem>[]) => {
			activeItem.onItemsRendered(items);
			if (diagnosticsEnabled) perfMessageScrollRecordRenderedItems(items);
		},
		[activeItem.onItemsRendered, diagnosticsEnabled],
	);
	const state = useMemo(
		() => ({ model, activeIndex: activeItem.activeIndex, onItemsRendered }),
		[model, activeItem.activeIndex, onItemsRendered],
	);
	return (
		<ConversationViewportContext.Provider value={state}>
			<MessageFeed.Root>
				<MessageFeedLayout.Frame asChild>
					<div data-message-viewport="stable">{children}</div>
				</MessageFeedLayout.Frame>
			</MessageFeed.Root>
		</ConversationViewportContext.Provider>
	);
}
