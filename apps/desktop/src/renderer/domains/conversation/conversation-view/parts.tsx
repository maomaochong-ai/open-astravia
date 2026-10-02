import { Button } from "@shared/components/ui/button";
import { type ConversationParticipantViewModel, conversationItemRenderKey } from "@shared/conversation";
import { PerfMessageScrollProfiler } from "@shared/lib/perf-message-scroll-profiler";
import {
	perfMessageScrollEnabled,
	perfMessageScrollRecordItemSize,
	perfMessageScrollRecordRange,
	perfMessageScrollRecordTotalHeight,
} from "@shared/lib/perf-message-scroll";
import type { ChatConversationItem } from "@shared/store/chat-atoms";
import type { Usage } from "@vetta/ai/protocol";
import { MessageFeed, MessageFeedLayout } from "@vetta-org/theme-ui/chat";
import { memo, type ReactNode, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ListRange, SizeFunction } from "react-virtuoso";
import { buildMessageHeightEstimates, createMessageItemSizeRecorder } from "../components/message-list/message-height-estimates";
import { collectAgentUsages } from "../components/message-list/message-list-derived";
import { MessageItem, ModelSwitchBoundary } from "../components/message-list/MessageItem";
import { MessageRow } from "../components/message-list/MessageRendering";
import { MessageTimeline } from "../components/message-list/MessageTimeline";
import { ConversationRowDecorations } from "./extensions";
import { ConversationMessageScope } from "./message-scope";
import { type MessageTemplates, useMessageTemplates } from "./templates";
import { ConversationUsagesContext } from "./usages";
import { useConversationViewport } from "./viewport-frame";

const VIEWPORT_BUFFER = { top: 320, bottom: 80 };

interface VirtualizerIdentityState {
	readonly feedKey: string | null;
	readonly itemIdentity: string;
	readonly generation: number;
}

function messageCollectionIdentity(messages: readonly ChatConversationItem[]): string {
	const first = messages.at(0);
	const last = messages.at(-1);
	return `${messages.length}:${first ? conversationItemRenderKey(first) : ""}:${last ? conversationItemRenderKey(last) : ""}`;
}

function useMessageVirtualizerKey(feedKey: string | null, messages: readonly ChatConversationItem[]): number {
	const itemIdentity = messageCollectionIdentity(messages);
	const identityRef = useRef<VirtualizerIdentityState | null>(null);
	const previous = identityRef.current;
	if (previous === null) {
		identityRef.current = { feedKey, itemIdentity, generation: 0 };
		return 0;
	}
	if (previous.feedKey === feedKey) {
		identityRef.current = { ...previous, itemIdentity };
		return previous.generation;
	}
	// A newly created conversation first has no durable path. Resolving that path must not
	// remount the same visible rows; switching between two actual conversations must reset
	// Virtuoso's index-based size tree so measurements cannot leak across conversations.
	const resolvesPendingConversation =
		previous.feedKey === null && feedKey !== null && previous.itemIdentity === itemIdentity;
	const generation = resolvesPendingConversation ? previous.generation : previous.generation + 1;
	identityRef.current = { feedKey, itemIdentity, generation };
	return generation;
}

interface TemplateRowProps {
	readonly template: ReactNode;
	readonly message: ChatConversationItem;
	readonly index: number;
	readonly isTail: boolean;
	readonly isLastUserMessage: boolean;
	readonly participant?: ConversationParticipantViewModel;
}

/** One row rendered from a message template; memoized so only rows whose message changed re-render. */
const TemplateRow = memo(function TemplateRow({ template, ...row }: TemplateRowProps) {
	return <ConversationMessageScope row={row}>{template}</ConversationMessageScope>;
});

/**
 * The virtualized message rows. Declare `<Conversation.UserMessage>`,
 * `<Conversation.AgentMessage>` or `<Conversation.EventMessage>` as children to
 * give a kind its own structure; kinds without a template use the default rendering.
 */
export function ConversationMessages({ children }: { readonly children?: ReactNode }) {
	const { model, onItemsRendered } = useConversationViewport("Conversation.Messages");
	const templates: MessageTemplates = useMessageTemplates(children);
	const {
		isStreaming,
		messages,
		modelSwitchLabels,
		scroll,
		tailMessageId,
		participantsById,
		participants,
		onTeamMemberOpen,
		feedKey,
		deferredContentReady,
		pendingLabel,
		onAbort,
	} = model;
	const diagnosticsEnabled = perfMessageScrollEnabled();
	const virtualizerKey = useMessageVirtualizerKey(feedKey, messages);
	const heightEstimates = useMemo(() => buildMessageHeightEstimates(messages, feedKey), [messages, feedKey]);
	const itemSize = useMemo<SizeFunction>(() => {
		const measure = createMessageItemSizeRecorder(messages, feedKey);
		if (!diagnosticsEnabled) return measure;
		return (element, field) => {
			const measured = measure(element, field);
			if (field !== "offsetHeight") return measured;
			const index = Number.parseInt(element.dataset.itemIndex ?? "", 10);
			const estimated = Number.isInteger(index) ? heightEstimates[index] : undefined;
			if (estimated !== undefined) perfMessageScrollRecordItemSize(index, estimated, measured);
			return measured;
		};
	}, [diagnosticsEnabled, heightEstimates, messages, feedKey]);
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
	const sessionUsagesRef = useRef<readonly Usage[]>([]);
	sessionUsagesRef.current = useMemo<readonly Usage[]>(
		() => collectAgentUsages(deferredContentReady ? messages : messages.slice(-4), sessionUsagesRef.current),
		[deferredContentReady, messages],
	);
	const itemContent = useCallback(
		(index: number, message: ChatConversationItem) => {
			const modelSwitchLabel = modelSwitchLabels.get(message.id);
			const participant = message.kind === "agent" ? participantsById.get(message.authorId) : undefined;
			const isTail = message.id === tailMessageId;
			const isLastUserMessage = message.id === lastUserMessageId;
			const template = templates[message.kind];
			return (
				<MessageRow message={message} isLast={index === messages.length - 1}>
					{modelSwitchLabel && <ModelSwitchBoundary {...modelSwitchLabel} />}
					<ConversationRowDecorations message={message}>
						{template !== undefined ? (
							<TemplateRow
								template={template}
								message={message}
								index={index}
								isTail={isTail}
								isLastUserMessage={isLastUserMessage}
								{...(participant ? { participant } : {})}
							/>
						) : (
							<MessageItem
								message={message}
								isTailMessage={isTail}
								isStreaming={isStreaming}
								isLastUserMessage={isLastUserMessage}
								onAbortEdit={onAbort}
								participant={participant}
								pendingLabel={
									message.kind === "agent" &&
									(message.phase === "pending" ||
										(message.phase === "streaming" && message.blocks.length === 0 && !message.text))
										? pendingLabel
										: undefined
								}
								participants={participants}
								sessionUsages={message.kind === "agent" ? sessionUsagesRef.current : undefined}
								onTeamMemberOpen={onTeamMemberOpen}
							/>
						)}
					</ConversationRowDecorations>
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
			templates,
		],
	);

	return (
		<ConversationUsagesContext.Provider value={sessionUsagesRef.current}>
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
						itemsRendered={onItemsRendered}
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
		</ConversationUsagesContext.Provider>
	);
}

/** Content after the last message, inside the scrolled list (waiting state, suggestions). */
export function ConversationFooter({ children }: { readonly children?: ReactNode }) {
	return (
		<MessageFeed.Footer>
			<div className="pb-16">{children}</div>
		</MessageFeed.Footer>
	);
}

/**
 * Floating question index on the left edge of the conversation. It needs no
 * message-column width; below 52rem the column fills the area and it hides.
 */
export function ConversationTimelineRail() {
	const { model, activeIndex } = useConversationViewport("Conversation.TimelineRail");
	if (!model.deferredContentReady) return null;
	return (
		<MessageFeedLayout.LeftRail>
			<MessageFeedLayout.RailContent>
				<MessageTimeline
					key={model.feedKey ?? "message-timeline"}
					activeMessageIndex={activeIndex}
					messages={model.messages}
					onNavigate={model.scroll.scrollToMessage}
				/>
			</MessageFeedLayout.RailContent>
		</MessageFeedLayout.LeftRail>
	);
}

/** Shown once the reader is far enough from the newest message. */
export function ConversationScrollToBottom() {
	const { t } = useTranslation("chat");
	const { model } = useConversationViewport("Conversation.ScrollToBottom");
	if (!model.scroll.showScrollToBottom) return null;
	return (
		<Button
			type="button"
			variant="outline"
			size="icon"
			className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-full border-border/60 bg-background/90 text-muted-foreground shadow-md backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground"
			aria-label={t("messageList.scrollToBottom")}
			title={t("messageList.scrollToBottom")}
			onClick={model.scroll.scrollToBottom}
		>
			<span className="icon-[solar--arrow-down-linear] h-3.5 w-3.5" aria-hidden="true" />
		</Button>
	);
}
