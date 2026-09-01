import {
	ConversationTimelineView,
	MessageListView as ThemeMessageListView,
	MessageSelectionContextMenuView,
	VirtuosoListContainer,
} from "@vetta/theme-ui/chat";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ListItem } from "react-virtuoso";
import { useMessageSelectionContextMenu } from "../../hooks/useMessageSelectionContextMenu";
import { SuggestionBubbles } from "../SuggestionBubbles";
import { ForkOriginBanner, resolveForkOriginPlacement } from "./ForkOriginBanner";
import { MessageItem, ModelSwitchBoundary, ExportMessageList } from "./MessageItem";
import { MessageListFooter } from "./MessageListFooter";
import { MessageTimeline } from "./MessageTimeline";
import { findTopVisibleMessageIndex, type RenderedMessageItem } from "./messageNavigationModel";
import type { ChatMessage, MessageListModel, MessageListProps } from "./types";

export { ExportMessageList };

const STREAMING_OVERSCAN = 80;
const IDLE_OVERSCAN = 400;
const INITIAL_OVERSCAN = 0;
const STREAMING_INCREASE_VIEWPORT_BY = { top: 0, bottom: 80 };
const IDLE_INCREASE_VIEWPORT_BY = { top: 200, bottom: 200 };
const INITIAL_INCREASE_VIEWPORT_BY = { top: 0, bottom: 0 };
const VIRTUOSO_STYLE = { overflowX: "hidden" as const };
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
	const [activeMessageIndex, setActiveMessageIndex] = useState(() => Math.max(0, messages.length - 1));
	useEffect(() => {
		setActiveMessageIndex(Math.max(0, messages.length - 1));
	}, [sessionId]);
	const renderedItemsRef = useRef<RenderedMessageItem[]>([]);
	const [scrollerElement, setScrollerElement] = useState<HTMLElement | null>(null);
	const syncActiveMessageIndex = useCallback(() => {
		if (!scrollerElement) return;
		const index = findTopVisibleMessageIndex(renderedItemsRef.current, scrollerElement.scrollTop);
		if (index != null) setActiveMessageIndex(index);
	}, [scrollerElement]);
	const onItemsRendered = useCallback(
		(items: ListItem<ChatMessage>[]) => {
			renderedItemsRef.current = items.map(({ index, offset, size }) => ({ index, offset, size }));
			syncActiveMessageIndex();
		},
		[syncActiveMessageIndex],
	);
	const setScrollerRef = useCallback(
		(element: HTMLElement | Window | null) => {
			scroll.scrollerRef(element);
			setScrollerElement(element instanceof HTMLElement ? element : null);
		},
		[scroll.scrollerRef],
	);
	useEffect(() => {
		if (!scrollerElement) return;
		let frame: number | null = null;
		const onScroll = (): void => {
			if (frame != null) return;
			frame = requestAnimationFrame(() => {
				frame = null;
				syncActiveMessageIndex();
			});
		};
		scrollerElement.addEventListener("scroll", onScroll, { passive: true });
		syncActiveMessageIndex();
		return () => {
			if (frame != null) cancelAnimationFrame(frame);
			scrollerElement.removeEventListener("scroll", onScroll);
		};
	}, [scrollerElement, syncActiveMessageIndex]);
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
	const footer = useCallback(
		() => (
			// Workflow footer sits above input-suggestion capsules; pb-16 clears the floating InputBar.
			<div className="pb-16">
				<MessageListFooter
					isCompacting={isCompacting}
					showWaiting={showWaiting}
					showWorkflows={sessionId != null}
					pendingLabel={pendingLabel}
				/>
				{onSend && <SuggestionBubbles onSend={onSend} />}
			</div>
		),
		[isCompacting, showWaiting, onSend, pendingLabel, sessionId],
	);
	const selectionMenu = useMessageSelectionContextMenu();

	return (
		<>
			<div
				ref={selectionMenu.containerRef}
				className="@container relative flex min-h-0 flex-1 flex-col"
				data-message-viewport={viewportPhase}
				onContextMenuCapture={selectionMenu.onContextMenuCapture}
			>
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<ThemeMessageListView
						virtuoso={
							<ConversationTimelineView
								virtuosoRef={scroll.virtuosoRef}
								scrollerRef={setScrollerRef}
								items={messages}
								style={VIRTUOSO_STYLE}
								atBottomStateChange={scroll.onAtBottomChange}
								atBottomThreshold={80}
								itemsRendered={onItemsRendered}
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
								list={VirtuosoListContainer}
								footer={footer}
								renderItem={itemContent}
								initialTopMostItemIndex={messages.length > 0 ? messages.length - 1 : 0}
							/>
						}
					/>
				</div>
				{/* 悬浮在会话区域左缘，不占消息列宽度；窄于 52rem 时消息列铺满整个会话区，
				    目录会压住气泡，直接整条隐藏。 */}
				<div className="pointer-events-none absolute top-1/2 left-3 z-20 -translate-y-1/2 @max-[52rem]:hidden">
					<div className="pointer-events-auto">
						<MessageTimeline
							key={sessionId ?? "message-timeline"}
							activeMessageIndex={activeMessageIndex}
							messages={messages}
							onNavigate={scroll.scrollToMessage}
						/>
					</div>
				</div>
			</div>
			{selectionMenu.contextMenu
				? createPortal(
						<MessageSelectionContextMenuView {...selectionMenu.contextMenu} />,
						document.body,
					)
				: null}
		</>
	);
}

// re-export for any external consumers that used the local container
export const MessageListVirtuosoListContainer = VirtuosoListContainer;
