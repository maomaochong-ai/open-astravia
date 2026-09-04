import { BotAvatar } from "@shared/components/BotAvatar";
import type { ConversationAgentMessageViewModel, ConversationParticipantViewModel } from "@shared/conversation";
import { useThemeSurface } from "@vetta/theme-sdk/appearance";
import { ThemeSurface } from "@vetta/theme-ui/appearance";
import {
	AssistantMessage as AssistantMessagePrimitive,
	AgentAvatarView,
	Message,
	MessageLayout,
	StreamingIndicator as ThemeStreamingIndicator,
} from "@vetta/theme-ui/chat";
import { memo, useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAssistantMessageModel } from "../../hooks/useAssistantMessageModel";
import { MessageCardsHost } from "../MessageCardsHost";
import { SegmentRenderer } from "./MessageBlockSegments";
import type { BlockSegment } from "./messageBlockModel";
import { segmentKey } from "./messageBlockModel";
import { useExpansion } from "./expansionStore";
import { workSegmentKey } from "./progressGroupModel";
import { WorkSegmentRenderer } from "./WorkSegmentRenderer";
import { CopyButton, formatTime, RelativeTimeLabel } from "./MessageActions";
import { MessageTokenUsage } from "./MessageTokenUsage";
import { formatTurnDuration } from "./turnDuration";

/** Desktop wrapper: injects i18n streaming phrases into theme-ui indicator. */
export function StreamingIndicator(): JSX.Element {
	const { t } = useTranslation("chat");
	const phrases = t("messageList.streamingPhrases", { returnObjects: true });
	const list = Array.isArray(phrases) ? (phrases as string[]) : [];
	return <ThemeStreamingIndicator phrases={list} />;
}

interface AssistantMessageProps {
	exportMode?: boolean;
	isStreaming: boolean;
	isTailMessage: boolean;
	message: ConversationAgentMessageViewModel;
	participant?: ConversationParticipantViewModel;
}

export const AssistantMessage = memo(function AssistantMessage({
	message,
	isTailMessage,
	isStreaming,
	exportMode = false,
	participant,
}: AssistantMessageProps) {
	const { t } = useTranslation("chat");
	const surface = useThemeSurface("chat.assistantMessage");
	// 展开态外置：Virtuoso 会卸载滚出视窗的高条目，组件内 state 会被清掉。
	// Tool calls are part of the transcript's observable data. Keep process
	// blocks visible by default; users can still collapse them with the shared
	// fold control without changing the underlying message projection.
	const [expanded, toggleExpanded] = useExpansion(`fold:${message.id}`, true);
	const generatedId = useId();
	const exportFoldPanelId = exportMode ? `export-assistant-fold-${generatedId}` : undefined;
	const model = useAssistantMessageModel({
		expanded,
		exportMode,
		isStreaming,
		isTailMessage,
		message,
	});

	const {
		conclusionText,
		exportProcessSegments,
		foldData,
		isCurrentlyStreaming,
		isPredicting,
		liveThinkingId,
		stagedNarration,
		segments,
		durationAvailable,
		streamingTailIndex,
		workFoldCount,
	} = model;

	const labels = useMemo(() => {
		const phrases = t("messageList.streamingPhrases", { returnObjects: true });
		// Work 折叠条说的是「阶段」，coding 说的是「过程条数」。
		const foldNamespace = stagedNarration ? "messageList.assistantFoldTip.work" : "messageList.assistantFoldTip";
		return {
			processing: t("messageList.assistantMessage.processing"),
			waiting: t("messageList.assistantMessage.waiting"),
			predicting: t("messageList.assistantMessage.predicting"),
			streamingFold: (elapsed: number) =>
				t("messageList.assistantFoldTip.streaming", {
					duration: formatTurnDuration(elapsed, t),
				}),
			waitingFold: (elapsed: number) =>
				t("messageList.assistantFoldTip.waiting", {
					duration: formatTurnDuration(elapsed, t),
				}),
			// 被折走的过程里一个阶段都没有（例如只有零散的单次调用）时，不说数量。
			expandFold: (count: number) =>
				stagedNarration && count === 0
					? t("messageList.assistantFoldTip.work.expandZero")
					: t(`${foldNamespace}.expand`, { count }),
			collapseFold: (count: number) =>
				stagedNarration && count === 0
					? t("messageList.assistantFoldTip.work.collapseZero")
					: t(`${foldNamespace}.collapse`, { count }),
			streamingPhrases: Array.isArray(phrases) ? (phrases as string[]) : [],
		};
	}, [t, stagedNarration]);

	const hasBlocks = message.blocks.length > 0;
	const isAwaitingFirstActivity = isCurrentlyStreaming && !hasBlocks && (message.text?.length ?? 0) === 0;
	const fold = isCurrentlyStreaming
		? {
				kind: "streaming" as const,
				count: message.blocks.length,
				startedAt: message.startedAt ?? message.timestamp,
				waitingForFirstActivity: isAwaitingFirstActivity,
			}
		: foldData
			? {
					kind: "complete" as const,
					count: stagedNarration ? workFoldCount : foldData.hiddenCount,
					expanded,
					exportPanelId: exportFoldPanelId,
				}
			: null;

	const showTokenUsage = !exportMode && Boolean(message.usages?.length);
	const hasActions = conclusionText.length > 0 || showTokenUsage;

	return (
		<Message.Root>
			<MessageLayout.Incoming
				className={surface?.rootClassName}
				data-theme-surface-root="chat.assistantMessage"
			>
				<ThemeSurface slot="chat.assistantMessage" />
				<MessageLayout.IncomingSurface>
					<MessageLayout.Header>
						<MessageLayout.HeaderLeading asChild>
							{participant ? (
								<AgentAvatarView
									name={participant.name}
									avatar={participant.avatar}
									blueprintId={participant.blueprintId}
									active={isCurrentlyStreaming}
								/>
							) : (
								<BotAvatar active={isCurrentlyStreaming} />
							)}
						</MessageLayout.HeaderLeading>
						<Message.Author>{participant?.name ?? "Vetta"}</Message.Author>
						{message.timestamp ? <Message.Meta>{formatTime(message.timestamp)}</Message.Meta> : null}
						{durationAvailable ? (
							<>
								<span className="text-[11px] text-muted-foreground/20">·</span>
								<Message.Meta>
									{formatTurnDuration(message.durationSeconds ?? 0, t)}
								</Message.Meta>
							</>
						) : null}
						{isCurrentlyStreaming ? (
							<Message.Status className="flex">
								<AssistantMessagePrimitive.StreamingStatus
									label={isAwaitingFirstActivity ? labels.waiting : labels.processing}
								/>
							</Message.Status>
						) : null}
					</MessageLayout.Header>

					{fold?.kind === "streaming" ? (
						<AssistantMessagePrimitive.Fold
							state="streaming"
							count={fold.count}
							expanded
							startedAt={fold.startedAt}
							waitingForFirstActivity={fold.waitingForFirstActivity}
							onToggle={() => undefined}
							labels={labels}
						/>
					) : fold?.kind === "complete" ? (
						<AssistantMessagePrimitive.Fold
							state="complete"
							count={fold.count}
							expanded={fold.expanded}
							onToggle={toggleExpanded}
							exportPanelId={fold.exportPanelId}
							labels={labels}
						/>
					) : null}

					<div>
						{hasBlocks ? (
							<div className="flex flex-col gap-0.5">
						{exportProcessSegments.length > 0 && (
							<div
								id={exportFoldPanelId}
								data-export-collapse-panel=""
								hidden
								className="flex flex-col gap-0.5"
							>
								{exportProcessSegments.map((segment) => (
									<SegmentRenderer
										key={`export-${segmentKey(segment)}`}
										segment={segment}
										exportMode
									/>
								))}
							</div>
						)}
						{segments.map((segment, index) =>
							stagedNarration ? (
								<WorkSegmentRenderer
									key={workSegmentKey(segment)}
									segment={segment}
									isStreamingTail={index === streamingTailIndex}
									isLiveActivity={isCurrentlyStreaming && index === segments.length - 1}
									liveThinkingId={liveThinkingId}
									animateIn={isCurrentlyStreaming && index === segments.length - 1}
									exportMode={exportMode}
								/>
							) : (
								<SegmentRenderer
									key={workSegmentKey(segment)}
									segment={segment as BlockSegment}
									isStreamingTail={index === streamingTailIndex}
									liveThinkingId={liveThinkingId}
									animateIn={isCurrentlyStreaming && index === segments.length - 1}
									exportMode={exportMode}
								/>
							),
						)}
							</div>
						) : !isAwaitingFirstActivity ? (
							<div
								className="text-[14px] leading-[1.6] text-foreground"
								style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
							>
								{message.text || "\u2026"}
							</div>
						) : null}
					</div>

					{isCurrentlyStreaming && !isAwaitingFirstActivity ? (
						<div className="mt-2 flex items-center">
							<AssistantMessagePrimitive.StreamingIndicator phrases={labels.streamingPhrases} />
						</div>
					) : null}

					{(hasActions || isPredicting) && !isCurrentlyStreaming ? (
						<MessageLayout.Footer asChild>
							<div className="gap-2">
								{hasActions ? (
					<div className="flex items-center gap-1">
						{conclusionText.length > 0 && <CopyButton getText={() => conclusionText} />}
						{(message.endedAt ?? message.timestamp) && (
							<RelativeTimeLabel endedAt={(message.endedAt ?? message.timestamp) as number} />
						)}
						{showTokenUsage && <MessageTokenUsage usages={message.usages ?? []} />}
					</div>
								) : null}
								{isPredicting ? (
									<AssistantMessagePrimitive.PredictingStatus label={labels.predicting} />
								) : null}
							</div>
						</MessageLayout.Footer>
					) : null}

					<MessageLayout.AfterBody asChild>
						<div>
							<MessageCardsHost message={message} />
						</div>
					</MessageLayout.AfterBody>
				</MessageLayout.IncomingSurface>
			</MessageLayout.Incoming>
		</Message.Root>
	);
});
