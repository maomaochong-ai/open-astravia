import { PerfSessionSwitchProfiler } from "@shared/lib/perf-session-switch-profiler";
import { useAtomValue } from "jotai";
import { type ReactNode, useMemo } from "react";
import { MessageCardsScope } from "../hooks/useMessageCardsHostModel";
import { useDeferredMessageEnhancements } from "../hooks/useDeferredMessageEnhancements";
import { useMessageListModel } from "../hooks/useMessageListModel";
import { useMessageListScrollModel } from "../hooks/useMessageListScrollModel";
import { useConversationFeed } from "./feed";
import { type ConversationViewportModel, ConversationViewportFrame } from "./viewport-frame";

/** Only the newest messages are derived until the first frame has settled. */
const INITIAL_DERIVATION_MESSAGE_COUNT = 4;

/**
 * Reads the conversation feed and prepares the viewport model: scroll following,
 * deferred derivations and model-switch boundaries. Its children are the parts
 * that make up the visible list (messages, footer, timeline, scroll button).
 */
export function ConversationViewport({ children }: { readonly children: ReactNode }) {
	const feed = useConversationFeed("Conversation.Viewport");
	const messages = useAtomValue(feed.items);
	const isStreaming = useAtomValue(feed.streaming);
	const scroll = useMessageListScrollModel({
		isStreaming,
		messages,
		sessionId: feed.key,
		initialTargetKey: feed.scrollTarget?.key,
		onInitialTargetHandled: feed.scrollTarget?.onReached,
	});
	const deferredContentReady = useDeferredMessageEnhancements(feed.key, messages.length > 0);
	const derivationMessages = useMemo(
		() => (deferredContentReady ? messages : messages.slice(-INITIAL_DERIVATION_MESSAGE_COUNT)),
		[deferredContentReady, messages],
	);
	const listModel = useMessageListModel(
		{
			messages,
			isStreaming,
			participants: feed.participants,
			onTeamMemberOpen: feed.capabilities.openTeamMember,
		},
		scroll,
		derivationMessages,
	);
	const model = useMemo<ConversationViewportModel>(
		() => ({
			...listModel,
			feedKey: feed.key,
			deferredContentReady,
			...(feed.pendingLabel ? { pendingLabel: feed.pendingLabel } : {}),
			...(feed.capabilities.abort ? { onAbort: feed.capabilities.abort } : {}),
		}),
		[listModel, feed.key, deferredContentReady, feed.pendingLabel, feed.capabilities.abort],
	);
	return (
		<MessageCardsScope scope={feed.key} messages={derivationMessages}>
			<PerfSessionSwitchProfiler id={`MessageList:${deferredContentReady ? "deferred-ready" : "tail-first"}`}>
				<ConversationViewportFrame model={model}>{children}</ConversationViewportFrame>
			</PerfSessionSwitchProfiler>
		</MessageCardsScope>
	);
}
