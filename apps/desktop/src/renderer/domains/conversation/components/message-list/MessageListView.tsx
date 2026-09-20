import { MessageFeed, MessageFeedLayout } from "@vetta-org/theme-ui/chat";
import { useMessageFeedActiveItem } from "@shared/components/message-feed/useMessageFeedActiveItem";
import { useCallback, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { Usage } from "@vetta/ai/protocol";
import { conversationItemRenderKey } from "@shared/conversation";
import { MessageRow } from "./MessageRendering";
import { MessageItem, ModelSwitchBoundary, ExportMessageList } from "./MessageItem";
import { collectAgentUsages } from "./message-list-derived";
import { MessageTimeline } from "./MessageTimeline";
import type { ChatConversationItem, MessageListModel, MessageListProps } from "./types";

export { ExportMessageList };

const STREAMING_OVERSCAN = 80;
const IDLE_OVERSCAN = 400;
const INITIAL_OVERSCAN = 0;
// 动态高度消息仅靠像素 overscan 时，短消息/长工具消息会让 Virtuoso 在滚动阈值处反复换批。
// 保留固定数量的历史行，确保首次恢复会话后向上滚动时已有足够锚点可测量。
const STREAMING_MIN_OVERSCAN_ITEM_COUNT = { top: 8, bottom: 2 };
const IDLE_MIN_OVERSCAN_ITEM_COUNT = { top: 12, bottom: 4 };
const INITIAL_MIN_OVERSCAN_ITEM_COUNT = { top: 0, bottom: 0 };
// 向上滚动时提前挂载一段消息，避免 Virtuoso 在滚动阈值处一次性替换整批行并重算 padding-top。
// 流式期间保守一些，空闲时扩大缓冲以优先保证历史消息滚动稳定性。
const STREAMING_INCREASE_VIEWPORT_BY = { top: 400, bottom: 80 };
const IDLE_INCREASE_VIEWPORT_BY = { top: 600, bottom: 200 };
const INITIAL_INCREASE_VIEWPORT_BY = { top: 0, bottom: 0 };
/**
 * 未测量条目的高度估算。原值 80 远低于真实中位数（带工具调用的回复动辄几百 px），
 * 往上滚时 Virtuoso 每渲染一批就要大幅修正总高度与 scrollTop，滚动条抖且反复重测量。
 */
const DEFAULT_ITEM_HEIGHT = 200;

export function MessageListView({
	model,
	onAbort,
	children,
	viewportPhase,
	sessionId = null,
	pendingLabel,
}: {
	model: MessageListModel;
	onAbort: MessageListProps["onAbort"];
	children?: ReactNode;
	viewportPhase: "initial" | "expanded";
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
	// 未缓存的历史消息必须直接使用完整缓冲，避免 Virtuoso 首次测量时反复修正总高度。
	// 已缓存会话带有精确的测量快照，可以先恢复可见行，再于稳定后的空闲期扩大缓冲。
	const useInitialViewport =
		viewportPhase === "initial" && (messages.length === 0 || scroll.restoreStateFrom !== undefined);
	const activeItem = useMessageFeedActiveItem<ChatConversationItem>({
		scrollerElement,
		resetKey: sessionId,
		initialIndex: Math.max(0, messages.length - 1),
	});
	const lastUserMessageId = useMemo(() => {
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index];
			if (message.kind === "user") return message.id;
		}
		return null;
	}, [messages]);
	const sessionUsages = useMemo<readonly Usage[]>(() => collectAgentUsages(messages), [messages]);
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
					<div data-message-viewport={viewportPhase}>
						<MessageFeedLayout.Viewport>
							<MessageFeedLayout.Virtualizer asChild>
								<MessageFeed.VirtualList
									// 不通过 React key 强制卸载列表。runtime 建立时 sessionId
									// 可能从过渡值切到真实路径；强制 remount 会造成整屏闪烁。
									// 会话切换的滚动重置由 useMessageFeedActiveItem.resetKey 负责。
									virtuosoRef={scroll.virtuosoRef}
									restoreStateFrom={scroll.restoreStateFrom}
									scrollerRef={scroll.scrollerRef}
									items={messages}
									getKey={conversationItemRenderKey}
									atBottomStateChange={scroll.onAtBottomChange}
									atBottomThreshold={80}
									itemsRendered={activeItem.onItemsRendered}
									overscan={
										useInitialViewport ? INITIAL_OVERSCAN : isStreaming ? STREAMING_OVERSCAN : IDLE_OVERSCAN
									}
									minOverscanItemCount={
										useInitialViewport
											? INITIAL_MIN_OVERSCAN_ITEM_COUNT
											: isStreaming
												? STREAMING_MIN_OVERSCAN_ITEM_COUNT
												: IDLE_MIN_OVERSCAN_ITEM_COUNT
									}
									increaseViewportBy={
										useInitialViewport
											? INITIAL_INCREASE_VIEWPORT_BY
											: isStreaming
												? STREAMING_INCREASE_VIEWPORT_BY
												: IDLE_INCREASE_VIEWPORT_BY
									}
									defaultItemHeight={DEFAULT_ITEM_HEIGHT}
									initialTopMostItemIndex={messages.length > 0 ? messages.length - 1 : 0}
								>
									{(message, index) => itemContent(index, message)}
								</MessageFeed.VirtualList>
							</MessageFeedLayout.Virtualizer>
						</MessageFeedLayout.Viewport>
						<MessageFeed.Footer>
							<div className="pb-16">{children}</div>
						</MessageFeed.Footer>
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
		</>
	);
}
