import { BotAvatar } from "@shared/components/BotAvatar";
import type { ConversationParticipantViewModel } from "@shared/conversation";
import type { ChatAgentMessageViewModel, ChatToolCallPresentationViewModel } from "@shared/store/chat-atoms";
import type { Usage } from "@vetta/ai/protocol";
import { useThemeSurface } from "@vetta-org/theme-sdk/appearance";
import { ThemeSurface } from "@vetta-org/theme-ui/appearance";
import {
	AgentAvatarView,
	AssistantMessage as AssistantMessagePrimitive,
	Message,
	MessageLayout,
} from "@vetta-org/theme-ui/chat";
import { useAtomValue } from "jotai";
import { createContext, type ReactNode, useCallback, useContext, useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MessageCardsHost } from "../components/MessageCardsHost";
import { CopyButton, formatTime, RelativeTimeLabel } from "../components/message-list/MessageActions";
import { SegmentRenderer } from "../components/message-list/MessageBlockSegments";
import { MessageTokenUsage } from "../components/message-list/MessageTokenUsage";
import { useExpansion } from "../components/message-list/expansionStore";
import { type BlockSegment, segmentKey } from "../components/message-list/messageBlockModel";
import { workSegmentKey } from "../components/message-list/progressGroupModel";
import { formatTurnDuration } from "../components/message-list/turnDuration";
import type { AssistantMessageModel } from "../components/message-list/types";
import { WorkSegmentRenderer } from "../components/message-list/WorkSegmentRenderer";
import { useAssistantMessageModel } from "../hooks/useAssistantMessageModel";
import { useConversationFeed } from "./feed";
import { useMessageRow } from "./message-scope";
import { ConversationUsagesContext } from "./usages";

/** What an agent message is rendered from, however its root obtained it. */
export interface AgentMessageInput {
	readonly message: ChatAgentMessageViewModel;
	readonly isTail: boolean;
	/** The conversation has a running Turn. */
	readonly isStreaming: boolean;
	readonly exportMode?: boolean;
	readonly pendingLabel?: string;
	readonly participant?: ConversationParticipantViewModel;
	readonly predicting?: boolean;
	readonly sessionUsages?: readonly Usage[];
	readonly openTeamMember?: (memberId: string) => void;
}

type FoldState =
	| {
			readonly kind: "streaming";
			readonly count: number;
			readonly startedAt: number | undefined;
			readonly waitingForFirstActivity: boolean;
	  }
	| { readonly kind: "complete"; readonly count: number; readonly exportPanelId: string | undefined };

interface AgentMessageState {
	readonly input: AgentMessageInput;
	readonly model: AssistantMessageModel;
	readonly expanded: boolean;
	readonly toggleExpanded: () => void;
	readonly exportFoldPanelId: string | undefined;
	readonly labels: AgentMessageLabels;
	readonly isAwaitingFirstActivity: boolean;
	readonly awaitingLabel: string;
	readonly fold: FoldState | null;
	readonly showTokenUsage: boolean;
	readonly hasActions: boolean;
	readonly presentationFor: (segment: BlockSegment) => ChatToolCallPresentationViewModel | undefined;
}

type AgentMessageLabels = ReturnType<typeof useAgentMessageLabels>;

function useAgentMessageLabels() {
	const { t } = useTranslation("chat");
	return useMemo(() => {
		const phrases = t("messageList.streamingPhrases", { returnObjects: true });
		return {
			processing: t("messageList.assistantMessage.processing"),
			waiting: t("messageList.assistantMessage.waiting"),
			preparing: t("messageList.assistantMessage.preparing"),
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
				count === 0
					? t("messageList.assistantFoldTip.work.expandZero")
					: t("messageList.assistantFoldTip.work.expand", { count }),
			collapseFold: (count: number) =>
				count === 0
					? t("messageList.assistantFoldTip.work.collapseZero")
					: t("messageList.assistantFoldTip.work.collapse", { count }),
			streamingPhrases: Array.isArray(phrases) ? (phrases as string[]) : [],
		};
	}, [t]);
}

function useAgentMessageInputState(input: AgentMessageInput): AgentMessageState {
	const { message, exportMode = false } = input;
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
		isStreaming: input.isStreaming,
		isTailMessage: input.isTail,
		message,
		predicting: input.predicting ?? false,
	});
	const labels = useAgentMessageLabels();
	const toolCallPresentations = useMemo(
		() => new Map(message.toolCallPresentations?.map((presentation) => [presentation.toolCallId, presentation]) ?? []),
		[message.toolCallPresentations],
	);
	const presentationFor = useCallback(
		(segment: BlockSegment): ChatToolCallPresentationViewModel | undefined =>
			segment.type === "single" && segment.block.type === "tool_call"
				? toolCallPresentations.get(segment.block.toolCallId)
				: undefined,
		[toolCallPresentations],
	);
	const hasBlocks = message.blocks.length > 0;
	const isAwaitingFirstActivity = model.isCurrentlyStreaming && !hasBlocks && (message.text?.length ?? 0) === 0;
	const awaitingLabel =
		input.pendingLabel ?? (message.modelRequestStartedAt === undefined ? labels.preparing : labels.waiting);
	const fold: FoldState | null = model.isCurrentlyStreaming
		? {
				kind: "streaming",
				count: message.blocks.length,
				startedAt:
					(isAwaitingFirstActivity ? message.modelRequestStartedAt : undefined) ??
					message.startedAt ??
					message.timestamp,
				waitingForFirstActivity: isAwaitingFirstActivity,
			}
		: model.foldData
			? { kind: "complete", count: model.workFoldCount, exportPanelId: exportFoldPanelId }
			: null;
	const showTokenUsage = !exportMode && Boolean(message.usages?.length);
	return {
		input,
		model,
		expanded,
		toggleExpanded,
		exportFoldPanelId,
		labels,
		isAwaitingFirstActivity,
		awaitingLabel,
		fold,
		showTokenUsage,
		hasActions: model.conclusionText.length > 0 || showTokenUsage,
		presentationFor,
	};
}

const AgentMessageContext = createContext<AgentMessageState | null>(null);

function useAgentMessagePart(part: string): AgentMessageState {
	const state = useContext(AgentMessageContext);
	if (!state) throw new Error(`${part} must be rendered inside <AgentMessage.Root>`);
	return state;
}

/**
 * Renders an agent message from explicit input, outside a conversation feed
 * (export, standalone previews). Inside `<Conversation.AgentMessage>` use
 * `<AgentMessage.Root>`, which takes the same input from the row and the feed.
 */
export function AgentMessageProvider({
	input,
	children,
}: {
	readonly input: AgentMessageInput;
	readonly children: ReactNode;
}) {
	const state = useAgentMessageInputState(input);
	const surface = useThemeSurface("chat.assistantMessage");
	return (
		<AgentMessageContext.Provider value={state}>
			<Message.Root>
				<MessageLayout.Incoming className={surface?.rootClassName} data-theme-surface-root="chat.assistantMessage">
					<ThemeSurface slot="chat.assistantMessage" />
					<MessageLayout.IncomingSurface>{children}</MessageLayout.IncomingSurface>
				</MessageLayout.Incoming>
			</Message.Root>
		</AgentMessageContext.Provider>
	);
}

/** Whether the conversation's Runtime is predicting the next prompt; read only by the tail reply. */
function useFeedPredicting(isTail: boolean): boolean {
	const feed = useConversationFeed("AgentMessage.Root");
	const predicting = useAtomValue(feed.predicting);
	return isTail && predicting;
}

/** An agent reply in the row of the enclosing `<Conversation.AgentMessage>` template. */
function AgentMessageRoot({ children }: { readonly children?: ReactNode }) {
	const row = useMessageRow("AgentMessage.Root");
	const feed = useConversationFeed("AgentMessage.Root");
	const isStreaming = useAtomValue(feed.streaming);
	const predicting = useFeedPredicting(row.isTail);
	const sessionUsages = useContext(ConversationUsagesContext);
	const message = row.message.kind === "agent" ? row.message : null;
	if (!message) return null;
	const awaitingOutput =
		message.phase === "pending" || (message.phase === "streaming" && message.blocks.length === 0 && !message.text);
	return (
		<AgentMessageProvider
			input={{
				message,
				isTail: row.isTail,
				isStreaming,
				predicting,
				sessionUsages,
				...(awaitingOutput && feed.pendingLabel ? { pendingLabel: feed.pendingLabel } : {}),
				...(row.participant ? { participant: row.participant } : {}),
				...(feed.capabilities.openTeamMember ? { openTeamMember: feed.capabilities.openTeamMember } : {}),
			}}
		>
			{children}
		</AgentMessageProvider>
	);
}

/** Avatar, author, time, Turn duration and the running status. */
function AgentMessageHeader() {
	const { t } = useTranslation("chat");
	const { input, model, labels, isAwaitingFirstActivity, awaitingLabel } = useAgentMessagePart("AgentMessage.Header");
	const { message, participant } = input;
	return (
		<MessageLayout.Header>
			<MessageLayout.HeaderLeading asChild>
				{participant ? (
					<AgentAvatarView
						name={participant.name}
						avatar={participant.avatar}
						active={model.isCurrentlyStreaming}
						size="lg"
					/>
				) : (
					<BotAvatar active={model.isCurrentlyStreaming} />
				)}
			</MessageLayout.HeaderLeading>
			<Message.Author>{participant?.name ?? "Vetta"}</Message.Author>
			{message.timestamp ? <Message.Meta>{formatTime(message.timestamp)}</Message.Meta> : null}
			{model.durationAvailable ? (
				<>
					<span className="text-[11px] text-muted-foreground/20">·</span>
					<Message.Meta>{formatTurnDuration(message.durationSeconds ?? 0, t)}</Message.Meta>
				</>
			) : null}
			{model.isCurrentlyStreaming ? (
				<Message.Status className="flex">
					<AssistantMessagePrimitive.StreamingStatus
						label={isAwaitingFirstActivity ? awaitingLabel : labels.processing}
					/>
				</Message.Status>
			) : null}
		</MessageLayout.Header>
	);
}

/** The work summary bar: elapsed time while running, then a toggle for the process steps. */
function AgentMessageFold() {
	const { fold, expanded, toggleExpanded, labels } = useAgentMessagePart("AgentMessage.Fold");
	if (fold?.kind === "streaming") {
		return (
			<AssistantMessagePrimitive.Fold
				state="streaming"
				count={fold.count}
				expanded
				startedAt={fold.startedAt}
				waitingForFirstActivity={fold.waitingForFirstActivity}
				onToggle={() => undefined}
				labels={labels}
			/>
		);
	}
	if (fold?.kind === "complete") {
		return (
			<AssistantMessagePrimitive.Fold
				state="complete"
				count={fold.count}
				expanded={expanded}
				onToggle={toggleExpanded}
				exportPanelId={fold.exportPanelId}
				labels={labels}
			/>
		);
	}
	return null;
}

/** Thinking, tool calls and text of the reply, grouped into work segments. */
function AgentMessageContent() {
	const { input, model, exportFoldPanelId, isAwaitingFirstActivity, presentationFor } =
		useAgentMessagePart("AgentMessage.Content");
	const { message, exportMode = false } = input;
	const { segments, exportProcessSegments, streamingTailIndex, isCurrentlyStreaming, liveThinkingId } = model;
	if (message.blocks.length === 0) {
		if (isAwaitingFirstActivity) return null;
		return (
			<div
				className="text-[14px] leading-[1.6] text-foreground"
				style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
			>
				{message.text || "…"}
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-0.5">
			{exportProcessSegments.length > 0 && (
				<div id={exportFoldPanelId} data-export-collapse-panel="" hidden className="flex flex-col gap-0.5">
					{exportProcessSegments.map((segment) => (
						<SegmentRenderer
							key={`export-${segmentKey(segment)}`}
							segment={segment}
							presentation={presentationFor(segment)}
							exportMode
						/>
					))}
				</div>
			)}
			{segments.map((segment, index) => (
				<WorkSegmentRenderer
					key={workSegmentKey(segment)}
					segment={segment}
					isStreamingTail={index === streamingTailIndex}
					isLiveActivity={isCurrentlyStreaming && index === segments.length - 1}
					liveThinkingId={liveThinkingId}
					presentation={presentationFor(segment as BlockSegment)}
					onTeamMemberOpen={input.openTeamMember}
					animateIn={isCurrentlyStreaming && index === segments.length - 1}
					exportMode={exportMode}
				/>
			))}
		</div>
	);
}

/** Rotating phrases under a reply that is producing output. */
function AgentMessageStreamingIndicator() {
	const { model, isAwaitingFirstActivity, labels } = useAgentMessagePart("AgentMessage.StreamingIndicator");
	if (!model.isCurrentlyStreaming || isAwaitingFirstActivity) return null;
	return (
		<div className="mt-2 flex items-center">
			<AssistantMessagePrimitive.StreamingIndicator phrases={labels.streamingPhrases} />
		</div>
	);
}

/** Footer of a finished reply; hidden while it runs and when none of its parts apply. */
function AgentMessageActions({ children }: { readonly children?: ReactNode }) {
	const { model } = useAgentMessagePart("AgentMessage.Actions");
	if (model.isCurrentlyStreaming) return null;
	return (
		<MessageLayout.Footer asChild>
			<div className="gap-2 [&:not(:has(>:not(:empty)))]:hidden">{children}</div>
		</MessageLayout.Footer>
	);
}

/** One row of reply actions (copy, time, usage); collapses when empty. */
function AgentMessageActionBar({ children }: { readonly children?: ReactNode }) {
	return <div className="flex items-center gap-1 empty:hidden">{children}</div>;
}

/** Copies the reply's conclusion (its final text, without the process steps). */
function AgentMessageCopyAction() {
	const { model } = useAgentMessagePart("AgentMessage.CopyAction");
	if (model.conclusionText.length === 0) return null;
	return <CopyButton getText={() => model.conclusionText} />;
}

/** How long ago the reply ended, next to its other actions. */
function AgentMessageTime() {
	const { input, hasActions } = useAgentMessagePart("AgentMessage.Time");
	const endedAt = input.message.endedAt ?? input.message.timestamp;
	if (!hasActions || !endedAt) return null;
	return <RelativeTimeLabel endedAt={endedAt} />;
}

/** Tokens and cost of the reply, compared with the whole conversation. */
function AgentMessageTokenUsage() {
	const { input, showTokenUsage } = useAgentMessagePart("AgentMessage.TokenUsage");
	if (!showTokenUsage) return null;
	return <MessageTokenUsage usages={input.message.usages ?? []} sessionUsages={input.sessionUsages} />;
}

/** Shown on the newest reply while the Runtime predicts the next prompt. */
function AgentMessagePredictingStatus() {
	const { model, labels } = useAgentMessagePart("AgentMessage.PredictingStatus");
	if (!model.isPredicting) return null;
	return <AssistantMessagePrimitive.PredictingStatus label={labels.predicting} />;
}

/** Plugin and subagent cards produced by the reply. */
function AgentMessageCards() {
	const { input } = useAgentMessagePart("AgentMessage.Cards");
	return (
		<MessageLayout.AfterBody asChild>
			<div>
				<MessageCardsHost message={input.message} />
			</div>
		</MessageLayout.AfterBody>
	);
}

/** The standard layout of a reply, for templates that only add to or wrap it. */
export function AgentMessageBody() {
	return (
		<>
			<AgentMessageHeader />
			<AgentMessageFold />
			<div>
				<AgentMessageContent />
			</div>
			<AgentMessageStreamingIndicator />
			<AgentMessageActions>
				<AgentMessageActionBar>
					<AgentMessageCopyAction />
					<AgentMessageTime />
					<AgentMessageTokenUsage />
				</AgentMessageActionBar>
				<AgentMessagePredictingStatus />
			</AgentMessageActions>
			<AgentMessageCards />
		</>
	);
}

/** Parts for `<Conversation.AgentMessage>` templates (ADR-0147). */
export const AgentMessage = {
	Root: AgentMessageRoot,
	Header: AgentMessageHeader,
	Fold: AgentMessageFold,
	Content: AgentMessageContent,
	StreamingIndicator: AgentMessageStreamingIndicator,
	Actions: AgentMessageActions,
	ActionBar: AgentMessageActionBar,
	CopyAction: AgentMessageCopyAction,
	Time: AgentMessageTime,
	TokenUsage: AgentMessageTokenUsage,
	PredictingStatus: AgentMessagePredictingStatus,
	Cards: AgentMessageCards,
	Body: AgentMessageBody,
} as const;

/** The reply rendered by the enclosing `<AgentMessage.Root>`, for custom parts. */
export function useAgentMessage(): ChatAgentMessageViewModel {
	return useAgentMessagePart("useAgentMessage").input.message;
}
