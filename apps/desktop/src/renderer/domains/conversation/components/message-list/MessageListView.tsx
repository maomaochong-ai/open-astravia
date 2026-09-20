import { MessageFeed, MessageFeedLayout } from "@vetta-org/theme-ui/chat";
import { useMessageFeedActiveItem } from "@shared/components/message-feed/useMessageFeedActiveItem";
import { PerfMessageScrollProfiler } from "@shared/lib/perf-message-scroll-profiler";
import {
	perfMessageScrollAttach,
	perfMessageScrollEnabled,
	perfMessageScrollRecordItemSize,
	perfMessageScrollRecordRange,
	perfMessageScrollRecordRenderedItems,
	perfMessageScrollRecordTotalHeight,
} from "@shared/lib/perf-message-scroll";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { ListItem, ListRange, SizeFunction } from "react-virtuoso";
import type { Usage } from "@vetta/ai/protocol";
import { conversationItemRenderKey } from "@shared/conversation";
import { MessageRow } from "./MessageRendering";
import { MessageItem, ModelSwitchBoundary, ExportMessageList } from "./MessageItem";
import { collectAgentUsages } from "./message-list-derived";
import { MessageTimeline } from "./MessageTimeline";
import {
	buildMessageHeightEstimates,
	createMessageItemSizeRecorder,
} from "./message-height-estimates";
import type { ChatConversationItem, MessageListModel, MessageListProps } from "./types";

export { ExportMessageList };

const VIEWPORT_BUFFER = { top: 320, bottom: 80 };

interface VirtualizerIdentityState {
	readonly sessionId: string | null;
	readonly itemIdentity: string;
	readonly generation: number;
}

function messageCollectionIdentity(messages: readonly ChatConversationItem[]): string {
	const first = messages.at(0);
	const last = messages.at(-1);
	return `${messages.length}:${first ? conversationItemRenderKey(first) : ""}:${last ? conversationItemRenderKey(last) : ""}`;
}

function useMessageVirtualizerKey(
	sessionId: string | null | undefined,
	messages: readonly ChatConversationItem[],
): number {
	const normalizedSessionId = sessionId ?? null;
	const itemIdentity = messageCollectionIdentity(messages);
	const identityRef = useRef<VirtualizerIdentityState | null>(null);
	const previous = identityRef.current;
	if (previous === null) {
		identityRef.current = { sessionId: normalizedSessionId, itemIdentity, generation: 0 };
		return 0;
	}
	if (previous.sessionId === normalizedSessionId) {
		identityRef.current = { ...previous, itemIdentity };
		return previous.generation;
	}

	// A newly created conversation first has no durable path. Resolving that path must not
	// remount the same visible rows; switching between two actual conversations must reset
	// Virtuoso's index-based size tree so measurements cannot leak across sessions.
	const resolvesPendingSession =
		previous.sessionId === null && normalizedSessionId !== null && previous.itemIdentity === itemIdentity;
	const generation = resolvesPendingSession ? previous.generation : previous.generation + 1;
	identityRef.current = { sessionId: normalizedSessionId, itemIdentity, generation };
	return generation;
}

export function MessageListView({
	model,
	onAbort,
	children,
	deferredContentReady,
	sessionId = null,
	pendingLabel,
}: {
	model: MessageListModel;
	onAbort: MessageListProps["onAbort"];
	children?: ReactNode;
	deferredContentReady: boolean;
	sessionId?: MessageListProps["sessionId"];
	pendingLabel?: MessageListProps["pendingLabel"];
}): JSX.Element {
	const {
		isStreaming,
		messages,
		modelSwitchLabels,
		scroll,
		tailMessageId,
		participantsById,
		participants,
		onTeamMemberOpen,
	} = model;
	const scrollerElement = scroll.scrollerElement;
	const diagnosticsEnabled = perfMessageScrollEnabled();
	const virtualizerKey = useMessageVirtualizerKey(sessionId, messages);
	const heightEstimates = useMemo(
		() => buildMessageHeightEstimates(messages, sessionId),
		[messages, sessionId],
	);
	const itemSize = useMemo<SizeFunction>(() => {
		const measure = createMessageItemSizeRecorder(messages, sessionId);
		if (!diagnosticsEnabled) return measure;
		return (element, field) => {
			const measured = measure(element, field);
			if (field !== "offsetHeight") return measured;
			const index = Number.parseInt(element.dataset.itemIndex ?? "", 10);
			const estimated = Number.isInteger(index) ? heightEstimates[index] : undefined;
			if (estimated !== undefined) perfMessageScrollRecordItemSize(index, estimated, measured);
			return measured;
		};
	}, [diagnosticsEnabled, heightEstimates, messages, sessionId]);
	const activeItem = useMessageFeedActiveItem<ChatConversationItem>({
		scrollerElement,
		resetKey: sessionId,
		initialIndex: Math.max(0, messages.length - 1),
	});
	useEffect(() => {
		if (!diagnosticsEnabled || !scrollerElement) return;
		return perfMessageScrollAttach(scrollerElement);
	}, [diagnosticsEnabled, scrollerElement]);
	const handleItemsRendered = useCallback(
		(items: ListItem<ChatConversationItem>[]) => {
			activeItem.onItemsRendered(items);
			if (diagnosticsEnabled) perfMessageScrollRecordRenderedItems(items);
		},
		[activeItem.onItemsRendered, diagnosticsEnabled],
	);
	const handleRangeChanged = useCallback(
		(range: ListRange) => {
			if (diagnosticsEnabled) perfMessageScrollRecordRange(range);
		},
		[diagnosticsEnabled],
	);
	const handleTotalListHeightChange = useCallback(
		(height: number) => {
			scroll.onTotalListHeightChange(height);
			if (diagnosticsEnabled) perfMessageScrollRecordTotalHeight(height);
		},
		[diagnosticsEnabled, scroll.onTotalListHeightChange],
	);
	const lastUserMessageId = useMemo(() => {
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index];
			if (message.kind === "user") return message.id;
		}
		return null;
	}, [messages]);
	const sessionUsages = useMemo<readonly Usage[]>(
		() => collectAgentUsages(deferredContentReady ? messages : messages.slice(-4)),
		[deferredContentReady, messages],
	);
	const sessionUsagesRef = useRef(sessionUsages);
	sessionUsagesRef.current = sessionUsages;
	const itemContent = useCallback(
		(index: number, message: ChatConversationItem) => {
			return (
				<MessageRow message={message} isLast={index === messages.length - 1}>
					{modelSwitchLabels.has(message.id) && (
						<ModelSwitchBoundary label={modelSwitchLabels.get(message.id) as string} />
					)}
					<MessageItem
						message={message}
						isTailMessage={message.id === tailMessageId}
						isStreaming={isStreaming}
						isLastUserMessage={message.id === lastUserMessageId}
						onAbortEdit={onAbort}
						participant={message.kind === "agent" ? participantsById.get(message.authorId) : undefined}
						pendingLabel={message.kind === "agent" && message.phase === "pending" ? pendingLabel : undefined}
						participants={participants}
						sessionUsages={message.kind === "agent" ? sessionUsagesRef.current : undefined}
						onTeamMemberOpen={onTeamMemberOpen}
					/>
				</MessageRow>
			);
		},
		[
			isStreaming,
			lastUserMessageId,
			messages.length,
			modelSwitchLabels,
			onAbort,
			pendingLabel,
			tailMessageId,
			onTeamMemberOpen,
			participants,
			participantsById,
		],
	);

	return (
		<>
			<MessageFeed.Root>
				<MessageFeedLayout.Frame asChild>
					<div data-message-viewport="stable">
						<MessageFeedLayout.Viewport>
							<PerfMessageScrollProfiler>
								<MessageFeedLayout.Virtualizer asChild>
									<MessageFeed.VirtualList
										key={virtualizerKey}
										virtuosoRef={scroll.virtuosoRef}
										restoreStateFrom={scroll.restoreStateFrom}
										scrollerRef={scroll.scrollerRef}
										items={messages}
										getKey={conversationItemRenderKey}
										atBottomStateChange={scroll.onAtBottomChange}
										totalListHeightChanged={handleTotalListHeightChange}
										followOutput={scroll.followOutput}
										atBottomThreshold={80}
										itemsRendered={handleItemsRendered}
										{...(diagnosticsEnabled ? { rangeChanged: handleRangeChanged } : {})}
										overscan={0}
										increaseViewportBy={VIEWPORT_BUFFER}
										heightEstimates={heightEstimates}
										itemSize={itemSize}
										initialTopMostItemIndex={scroll.initialTopMostItemIndex}
									>
										{(message, index) => itemContent(index, message)}
									</MessageFeed.VirtualList>
								</MessageFeedLayout.Virtualizer>
							</PerfMessageScrollProfiler>
						</MessageFeedLayout.Viewport>
						<MessageFeed.Footer>
							<div className="pb-16">{children}</div>
						</MessageFeed.Footer>
						{/* 悬浮在会话区域左缘，不占消息列宽度；窄于 52rem 时消息列铺满整个会话区，
						    目录会压住气泡，直接整条隐藏。 */}
						{deferredContentReady ? <MessageFeedLayout.LeftRail>
							<MessageFeedLayout.RailContent>
								<MessageTimeline
									key={sessionId ?? "message-timeline"}
									activeMessageIndex={activeItem.activeIndex}
									messages={messages}
									onNavigate={scroll.scrollToMessage}
								/>
							</MessageFeedLayout.RailContent>
						</MessageFeedLayout.LeftRail> : null}
					</div>
				</MessageFeedLayout.Frame>
			</MessageFeed.Root>
		</>
	);
}
