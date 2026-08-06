import { activeSessionAtom } from "@shared/store/atoms";
import {
	MessageListView as ThemeMessageListView,
	MessageSelectionContextMenuView,
	VirtuosoListContainer,
} from "@vetta/theme-ui/chat";
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Virtuoso } from "react-virtuoso";
import { useMessageSelectionContextMenu } from "../../hooks/useMessageSelectionContextMenu";
import { SuggestionBubbles } from "../SuggestionBubbles";
import { ForkOriginBanner, resolveForkOriginPlacement } from "./ForkOriginBanner";
import { MessageItem, ModelSwitchBoundary, ExportMessageList } from "./MessageItem";
import { MessageListFooter } from "./MessageListFooter";
import type { ChatMessage, MessageListModel, MessageListProps } from "./types";

export { ExportMessageList };

const STREAMING_OVERSCAN = 80;
const IDLE_OVERSCAN = 400;
const STREAMING_INCREASE_VIEWPORT_BY = { top: 0, bottom: 80 };
const IDLE_INCREASE_VIEWPORT_BY = { top: 200, bottom: 200 };
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
	sessionId = null,
}: {
	model: MessageListModel;
	onAbort: MessageListProps["onAbort"];
	onSend: MessageListProps["onSend"];
	sessionId?: MessageListProps["sessionId"];
}): JSX.Element {
	const {
		isCompacting,
		isStreaming,
		messages,
		modelSwitchLabels,
		scroll,
		showWaiting,
		tailMessageId,
	} = model;
	const activeSession = useAtomValue(activeSessionAtom);
	const forkOriginPlacement = useMemo(
		() =>
			resolveForkOriginPlacement(
				messages,
				activeSession?.parentEntryId,
				Boolean(activeSession?.parentSessionPath),
			),
		[activeSession?.parentEntryId, activeSession?.parentSessionPath, messages],
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
						userMessageEntryState={
							message.id === scroll.activeUserAnimationId
								? "enter"
								: message.id === scroll.pendingUserAnimationId ||
										message.id === scroll.enteringUserMessageId
									? "hidden"
									: "static"
						}
						onUserMessageEntryComplete={
							message.id === scroll.activeUserAnimationId
								? scroll.onUserMessageEntryComplete
								: undefined
						}
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
			scroll.activeUserAnimationId,
			scroll.enteringUserMessageId,
			scroll.onUserMessageEntryComplete,
			scroll.pendingUserAnimationId,
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
				/>
				{onSend && <SuggestionBubbles onSend={onSend} />}
			</div>
		),
		[isCompacting, showWaiting, onSend, sessionId],
	);
	const components = useMemo(
		() => ({ List: VirtuosoListContainer, Footer: footer }),
		[footer],
	);
	const selectionMenu = useMessageSelectionContextMenu();

	return (
		<>
			<div
				ref={selectionMenu.containerRef}
				className="flex min-h-0 flex-1 flex-col"
				onContextMenuCapture={selectionMenu.onContextMenuCapture}
			>
				<ThemeMessageListView
					virtuoso={
						<Virtuoso
							ref={scroll.virtuosoRef}
							scrollerRef={scroll.scrollerRef}
							data={messages}
							className="flex-1 pt-2"
							style={VIRTUOSO_STYLE}
							atBottomStateChange={scroll.onAtBottomChange}
							atBottomThreshold={80}
							overscan={isStreaming ? STREAMING_OVERSCAN : IDLE_OVERSCAN}
							increaseViewportBy={
								isStreaming ? STREAMING_INCREASE_VIEWPORT_BY : IDLE_INCREASE_VIEWPORT_BY
							}
							defaultItemHeight={DEFAULT_ITEM_HEIGHT}
							components={components}
							itemContent={itemContent}
							initialTopMostItemIndex={messages.length > 0 ? messages.length - 1 : 0}
						/>
					}
				/>
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
