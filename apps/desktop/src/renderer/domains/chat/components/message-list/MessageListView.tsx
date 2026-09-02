import {
	MessageFeed,
	MessageFeedLayout,
	MessageSelectionContextMenuView,
} from "@vetta/theme-ui/chat";
import { useMessageFeedActiveItem } from "@shared/components/message-feed/useMessageFeedActiveItem";
import { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useMessageSelectionContextMenu } from "../../hooks/useMessageSelectionContextMenu";
import { SuggestionBubbles } from "../SuggestionBubbles";
import { ForkOriginBanner, resolveForkOriginPlacement } from "./ForkOriginBanner";
import { MessageItem, ModelSwitchBoundary, ExportMessageList } from "./MessageItem";
import { MessageListFooter } from "./MessageListFooter";
import { MessageTimeline } from "./MessageTimeline";
import type { ChatMessage, MessageListModel, MessageListProps } from "./types";

export { ExportMessageList };

const STREAMING_OVERSCAN = 80;
const IDLE_OVERSCAN = 400;
const INITIAL_OVERSCAN = 0;
const STREAMING_INCREASE_VIEWPORT_BY = { top: 0, bottom: 80 };
const IDLE_INCREASE_VIEWPORT_BY = { top: 200, bottom: 200 };
const INITIAL_INCREASE_VIEWPORT_BY = { top: 0, bottom: 0 };
/**
 * 未测量条目的高度估算。原值 80 远低于真实中位数（带工具调用的回复动辄几百 px），
 * 往上滚时 Virtuoso 每渲染一批就要大幅修正总高度与 scrollTop，滚动条抖且反复重测量。
 */
const DEFAULT_ITEM_HEIGHT = 200;

export function MessageListView({
	model,
	onAbort,
	onSend,
	viewportPhase,
	sessionId = null,
	pendingLabel,
}: {
	model: MessageListModel;
	onAbort: MessageListProps["onAbort"];
	onSend: MessageListProps["onSend"];
	viewportPhase: "initial" | "expanded";
	sessionId?: MessageListProps["sessionId"];
	pendingLabel?: MessageListProps["pendingLabel"];
}): JSX.Element {
	const {
		isCompacting,
		isStreaming,
		messages,
		modelSwitchLabels,
		parentEntryId,
		parentSessionPath,
		scroll,
		showWaiting,
		tailMessageId,
	} = model;
	const scrollerElement = scroll.scrollerElement;
	const activeItem = useMessageFeedActiveItem<ChatMessage>({
		scrollerElement,
		resetKey: sessionId,
		initialIndex: Math.max(0, messages.length - 1),
	});
	const forkOriginPlacement = useMemo(
		() =>
			resolveForkOriginPlacement(
				messages,
				parentEntryId,
				Boolean(parentSessionPath),
			),
		[parentEntryId, parentSessionPath, messages],
	);
	// 倒序单次扫描一次算出两个位置，避免在 itemContent 里对每个可见条目再做一次 O(n)
	// 的 slice/some（整条列表退化成 O(n²)，且流式期间每帧重跑）。
	const { lastUserMessageId, lastNonUserIndex } = useMemo(() => {
		let userId: string | null = null;
		let nonUserIndex = -1;
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index];
			if (message.role === "user") {
				if (userId === null) userId = message.id;
			} else if (nonUserIndex === -1) {
				nonUserIndex = index;
			}
			if (userId !== null && nonUserIndex !== -1) break;
		}
		return { lastUserMessageId: userId, lastNonUserIndex: nonUserIndex };
	}, [messages]);
	const itemContent = useCallback(
		(index: number, message: ChatMessage) => {
			const showForkOrigin = forkOriginPlacement?.anchorIndex === index;
			const sourceUser =
				showForkOrigin && forkOriginPlacement
					? messages[forkOriginPlacement.sourceUserIndex]
					: undefined;
			return (
				<div
					data-entry-id={message.entryId ?? message.id}
					className={
						index === messages.length - 1 && message.role === "user" && !showForkOrigin
							? "pb-9"
							: "pb-5"
					}
				>
					{modelSwitchLabels.has(message.id) && (
						<ModelSwitchBoundary label={modelSwitchLabels.get(message.id) as string} />
					)}
					<MessageItem
						message={message}
						isTailMessage={message.id === tailMessageId}
						isStreaming={isStreaming}
						isLastUserMessage={message.id === lastUserMessageId}
						hasAssistantAfter={index < lastNonUserIndex}
						onAbortEdit={onAbort}
					/>
					{showForkOrigin ? <ForkOriginBanner sourceMessage={sourceUser} /> : null}
				</div>
			);
		},
		[
			forkOriginPlacement,
			isStreaming,
			lastNonUserIndex,
			lastUserMessageId,
			messages.length,
			messages,
			modelSwitchLabels,
			onAbort,
			tailMessageId,
		],
	);
	const footer = useMemo(
		() => (
			// Workflow footer sits above input-suggestion capsules; pb-16 clears the floating InputBar.
			<MessageFeed.Footer asChild>
				<div className="pb-16">
					<MessageListFooter
						isCompacting={isCompacting}
						showWaiting={showWaiting}
						showWorkflows={sessionId != null}
						pendingLabel={pendingLabel}
					/>
					{onSend && <SuggestionBubbles onSend={onSend} />}
				</div>
			</MessageFeed.Footer>
		),
		[isCompacting, showWaiting, onSend, pendingLabel, sessionId],
	);
	const selectionMenu = useMessageSelectionContextMenu();

	return (
		<>
			<MessageFeed.Root>
				<MessageFeedLayout.Frame asChild>
					<div
						ref={selectionMenu.containerRef}
						data-message-viewport={viewportPhase}
						onContextMenuCapture={selectionMenu.onContextMenuCapture}
					>
						<MessageFeedLayout.Viewport>
							<MessageFeedLayout.Virtualizer asChild>
								<MessageFeed.VirtualList
									virtuosoRef={scroll.virtuosoRef}
									scrollerRef={scroll.scrollerRef}
									items={messages}
									getKey={(message) => message.entryId ?? message.id}
									atBottomStateChange={scroll.onAtBottomChange}
									atBottomThreshold={80}
									itemsRendered={activeItem.onItemsRendered}
									overscan={
										viewportPhase === "initial"
											? INITIAL_OVERSCAN
											: isStreaming
												? STREAMING_OVERSCAN
												: IDLE_OVERSCAN
									}
									increaseViewportBy={
										viewportPhase === "initial"
											? INITIAL_INCREASE_VIEWPORT_BY
											: isStreaming
												? STREAMING_INCREASE_VIEWPORT_BY
												: IDLE_INCREASE_VIEWPORT_BY
									}
									defaultItemHeight={DEFAULT_ITEM_HEIGHT}
									initialTopMostItemIndex={messages.length > 0 ? messages.length - 1 : 0}
								>
									<MessageFeedLayout.List />
									{(message, index) => itemContent(index, message)}
									{footer}
								</MessageFeed.VirtualList>
							</MessageFeedLayout.Virtualizer>
						</MessageFeedLayout.Viewport>
						{/* 悬浮在会话区域左缘，不占消息列宽度；窄于 52rem 时消息列铺满整个会话区，
						    目录会压住气泡，直接整条隐藏。 */}
						<MessageFeedLayout.LeftRail>
							<MessageFeedLayout.RailContent>
								<MessageTimeline
									key={sessionId ?? "message-timeline"}
									activeMessageIndex={activeItem.activeIndex}
									messages={messages}
									onNavigate={scroll.scrollToMessage}
								/>
							</MessageFeedLayout.RailContent>
						</MessageFeedLayout.LeftRail>
					</div>
				</MessageFeedLayout.Frame>
			</MessageFeed.Root>
			{selectionMenu.contextMenu
				? createPortal(
						<MessageSelectionContextMenuView {...selectionMenu.contextMenu} />,
						document.body,
					)
				: null}
		</>
	);
}
