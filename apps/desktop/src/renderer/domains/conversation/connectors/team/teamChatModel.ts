import type {
	DesktopTeamSessionSnapshot,
	DesktopTeamSessionStreamEvent,
} from "@preload/api-types/team-conversation-display";
import { agentAvatarUrl } from "@shared/agent-teams/agent-avatar";
import type {
	ConversationAgentMessageViewModel,
	ConversationMessageEventState,
	ConversationParticipantViewModel,
} from "@shared/conversation";
import {
	abortConversationAgentMessage,
	reduceConversationMessageEvent,
	settlePendingToolCalls,
} from "@shared/conversation";
import type { InputSegment } from "@shared/lib/input-tokens";
import type { ChatConversationItem, ChatToolCallPresentationViewModel, ContextUsageData } from "@shared/store/atoms";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { AgentTeamDocument, TeamDefinition } from "@vetta/agent-team";
import type { HistoryEntry, PromptAttachmentRef, SessionExecutionMode } from "@vetta/runtime-core";
import { fullHistoryToChat } from "../../services/chat-service";
import {
	projectConversationAgentMessage,
	reduceConversationToolExecutionEvent,
} from "../../services/conversation-projection";

export type TeamChatStatus = "loading" | "ready" | "sending" | "streaming" | "cancelling" | "error";

export interface TeamChatLabels {
	readonly leaderRoute: string;
	/** Display labels for the role badge rendered below each member avatar. */
	readonly memberRoles?: Readonly<Record<string, string>>;
	readonly memberRoleFallback: string;
	readonly placeholder: string;
	readonly attachFile: string;
	readonly attachImage: string;
}

export interface TeamChatViewModel {
	readonly feedKey: string;
	readonly title: string;
	readonly status: TeamChatStatus;
	readonly draft: string;
	readonly draftMemberMentions?: readonly {
		readonly participantId: string;
		readonly handle: string;
		readonly start: number;
		readonly end: number;
	}[];
	readonly history: readonly string[];
	readonly attachments: readonly TeamAttachmentViewModel[];
	readonly members: readonly TeamMemberViewModel[];
	readonly leaderMemberId?: string;
	readonly feedItems: readonly ChatConversationItem[];
	readonly pendingLabel?: string;
	readonly error?: string;
	readonly editorEnabled: boolean;
	readonly canSend: boolean;
	readonly workspace: ActivityWorkspace | null;
	readonly activeSessionId: string | null;
	readonly runtimeSessionIds?: readonly string[];
	readonly memberRuntimeIds?: Readonly<Record<string, string>>;
	readonly memberViewId?: string;
	readonly executionMode?: SessionExecutionMode;
	readonly contextUsage?: ContextUsageData | null;
	readonly contextUsagesByRuntime?: Readonly<Record<string, ContextUsageData>>;
	readonly compactingByRuntime?: Readonly<Record<string, boolean>>;
	readonly isCompacting?: boolean;
	readonly sessions: readonly { readonly id: string; readonly label: string }[];
	readonly sessionActionsDisabled: boolean;
	readonly modelKey: string | null;
	readonly reasoning?: string;
	readonly labels: TeamChatLabels;
}

export interface TeamChatActions {
	readonly setDraft: (draft: string, segments?: readonly InputSegment[]) => void;
	readonly selectFiles: () => Promise<void>;
	readonly selectImages: () => Promise<void>;
	readonly removeAttachment: (path: string) => void;
	readonly addAttachments: (attachments: readonly TeamAttachmentViewModel[]) => void;
	readonly send: (streamingBehavior?: "steer" | "followUp") => Promise<void>;
	readonly abort: () => Promise<void>;
	readonly createSession: () => Promise<string | undefined>;
	readonly openSession: (sessionId: string) => Promise<void>;
	readonly selectModel: (modelKey: string, defaultReasoning?: string) => Promise<void>;
	readonly selectReasoning: (reasoning: string) => Promise<void>;
	readonly setExecutionMode?: (mode: SessionExecutionMode) => Promise<void>;
}

export interface TeamAttachmentViewModel {
	readonly path: string;
	readonly name: string;
	readonly kind: "file" | "image";
}

export function updateScopedTeamDraft(
	drafts: Readonly<Record<string, string>>,
	teamId: string,
	update: string | ((current: string) => string),
): Readonly<Record<string, string>> {
	const previous = drafts[teamId] ?? "";
	const next = typeof update === "function" ? update(previous) : update;
	return next === previous ? drafts : { ...drafts, [teamId]: next };
}

export interface TeamMemberViewModel extends ConversationParticipantViewModel {
	readonly id: string;
	readonly kind: "agent";
	readonly name: string;
	readonly handle: string;
	readonly avatar?: string;
	readonly blueprintId: string;
	readonly selected: boolean;
	readonly status: "idle" | "working" | "error";
}

export interface TeamPendingRequest {
	readonly requestId: string;
	readonly text: string;
	readonly displayText?: string;
	readonly attachments?: readonly PromptAttachmentRef[];
	readonly targetMemberIds?: readonly string[];
	readonly memberMentions?: readonly {
		readonly participantId: string;
		readonly handle: string;
		readonly start: number;
		readonly end: number;
	}[];
	readonly leaderMemberId?: string;
	readonly timestamp?: number;
}

export type TeamStreamState = Readonly<Record<string, ConversationMessageEventState>>;

export interface TeamTimelineEventViewModel {
	readonly kind: "delegation";
	readonly requestId: string;
	readonly label: string;
	readonly timestamp: number;
}

type TeamMemberSummaryState = "pending" | "streaming" | "completed" | "failed" | "waiting" | "cancelled";

interface TeamMemberReplySummaryInput {
	readonly member: TeamMemberViewModel;
	readonly requestId: string;
	readonly timestamp: number;
	readonly activityState?: TeamMemberSummaryState;
	readonly message?: ConversationAgentMessageViewModel;
}

export interface TeamTimelineLabels {
	readonly delegation: (from: string, to: string) => string;
	readonly unknownMember: string;
}

const SUMMARY_TEXT_MAX_CHARACTERS = 72;

function compactTeamActivityText(text: string, maxCharacters = SUMMARY_TEXT_MAX_CHARACTERS): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized || maxCharacters <= 0) return "";
	const characters = Array.from(normalized);
	return characters.length <= maxCharacters ? normalized : `…${characters.slice(-(maxCharacters - 1)).join("")}`;
}

function toolActivityText(
	block: Extract<ConversationAgentMessageViewModel["blocks"][number], { type: "tool_call" }>,
): string {
	const phase = compactTeamActivityText(block.currentPhase ?? "");
	if (phase) return phase;
	const description =
		typeof block.args.description === "string" ? compactTeamActivityText(block.args.description) : "";
	if (description) return description;
	return compactTeamActivityText(block.toolName);
}

function publicTextPreview(message: ConversationAgentMessageViewModel): string {
	const text = message.blocks
		.filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	return compactTeamActivityText(text);
}

function buildTeamMemberReplySummary(input: TeamMemberReplySummaryInput): ChatConversationItem {
	const message = input.message;
	const blocks = message?.blocks ?? [];
	const pendingTool = [...blocks]
		.reverse()
		.find(
			(block): block is Extract<typeof block, { type: "tool_call" }> =>
				block.type === "tool_call" && block.status === "pending",
		);
	const latestThinking = [...blocks]
		.reverse()
		.find(
			(block): block is Extract<typeof block, { type: "thinking" }> =>
				block.type === "thinking" && block.text.trim().length > 0,
		);
	const allTools = blocks.filter(
		(block): block is Extract<typeof block, { type: "tool_call" }> =>
			block.type === "tool_call" && block.status !== "pending",
	);
	const currentTool =
		pendingTool ??
		[...blocks]
			.reverse()
			.find((block): block is Extract<typeof block, { type: "tool_call" }> => block.type === "tool_call");
	const currentText = currentTool
		? toolActivityText(currentTool)
		: latestThinking
			? compactTeamActivityText(latestThinking.text)
			: message
				? publicTextPreview(message)
				: "";
	const recent = allTools
		.slice(-2)
		.map((block) => toolActivityText(block))
		.filter(Boolean);
	const inferredState: TeamMemberSummaryState =
		input.activityState ??
		(message?.phase === "failed"
			? "failed"
			: message?.phase === "aborted"
				? "cancelled"
				: message?.phase === "completed"
					? "completed"
					: message?.phase === "pending"
						? "pending"
						: "streaming");
	const currentKind = currentTool ? "tool" : latestThinking ? "thinking" : currentText ? "text" : "status";
	const result = inferredState === "completed" && message ? publicTextPreview(message) : undefined;
	return {
		id: `team-member-summary:${input.requestId}:${input.member.id}`,
		renderKey: `team:member-summary:${input.requestId}:${input.member.id}`,
		kind: "event",
		timestamp: input.timestamp,
		event: {
			kind: "team-member-summary",
			requestId: input.requestId,
			memberId: input.member.id,
			memberName: input.member.name,
			...(input.member.avatar ? { memberAvatar: input.member.avatar } : {}),
			memberBlueprintId: input.member.blueprintId,
			state: inferredState,
			currentKind,
			...(currentText ? { current: currentText } : {}),
			recent,
			...(result ? { result } : {}),
			timestamp: input.timestamp,
		},
	};
}

export function reduceTeamStreamState(state: TeamStreamState, event: DesktopTeamSessionStreamEvent): TeamStreamState {
	if (event.type === "session-snapshot") {
		return (event.activeStreamEvents ?? event.activeMessageEvents).reduce(reduceTeamStreamState, {});
	}
	if (event.type === "session-updated") {
		const persisted = new Set(event.snapshot.messages.map((record) => record.id));
		return Object.fromEntries(
			Object.entries(state).filter(
				([messageId, turn]) => !persisted.has(messageId) || hasTerminalToolOverlay(turn.message),
			),
		);
	}
	if (event.type === "conversation.agent-message-discard") {
		const current = state[event.messageId];
		if (!current || event.sequence <= current.sequence) return state;
		// Keep a terminal tombstone for successful turns. Runtime delivery and
		// publication are separate async lanes, so a late assistant/tool event
		// must not recreate a stream after the discard event has closed it.
		if (event.reason === "completed") {
			return {
				...state,
				[event.messageId]: {
					...current,
					sequence: event.sequence,
					message: { ...current.message, phase: "completed", endedAt: event.timestamp },
				},
			};
		}
		if (event.reason === "aborted") {
			return {
				...state,
				[event.messageId]: {
					...current,
					sequence: event.sequence,
					message: abortConversationAgentMessage(current.message, event.timestamp),
				},
			};
		}
		const next = { ...state };
		delete next[event.messageId];
		return next;
	}
	if (event.type === "desktop.team-context-usage") return state;
	const current = state[event.messageId];
	if (current?.message.phase === "completed" || current?.message.phase === "aborted") return state;
	if (event.type === "desktop.team-tool-execution" || event.type === "conversation.tool-execution") {
		const next = reduceConversationToolExecutionEvent(current, event);
		if (next === current) return state;
		return { ...state, [event.messageId]: next };
	}
	const next = reduceConversationMessageEvent(current, event);
	if (next === current) return state;
	return {
		...state,
		[event.messageId]: next,
	};
}

/**
 * A Team tool execution is display-only and can finish after the assistant
 * message that contains its tool call has already been persisted. Dropping this
 * overlay on that snapshot would project the persisted `toolUse` record as a
 * fresh pending tool on the next user turn, even though no execution restarted.
 */
function hasTerminalToolOverlay(message: ConversationAgentMessageViewModel): boolean {
	return message.blocks.some((block) => block.type === "tool_call" && block.status !== "pending");
}

export function resolveTeamMembers(
	document: AgentTeamDocument | undefined,
	team: TeamDefinition | undefined,
	selectedMemberIds: readonly string[],
	streams: TeamStreamState,
	resolveName: (profileId: string, fallbackHandle: string) => string,
	failedMemberIds: ReadonlySet<string> = new Set(),
	durableWorkingMemberIds: readonly string[] = [],
): TeamMemberViewModel[] {
	if (!team) return [];
	const workingMembers = new Set(
		Object.values(streams)
			.filter((turn) => turn.message.phase === "streaming")
			.map((turn) => turn.message.authorId),
	);
	for (const memberId of durableWorkingMemberIds) workingMembers.add(memberId);
	return team.members.map((member) => {
		const profile = document?.agents.find((candidate) => candidate.id === member.binding.agentProfileId);
		return {
			id: member.id,
			kind: "agent",
			name: resolveName(member.binding.agentProfileId, member.handle),
			handle: member.handle,
			// Resolve a deterministic built-in avatar even when an older team document
			// does not contain the referenced profile. This keeps every Team surface
			// (sidebar, header and composer) visually consistent without mutating data.
			avatar: agentAvatarUrl({
				id: profile?.id ?? member.id,
				blueprintId: profile?.blueprintId ?? "leader",
				...(profile?.avatar ? { avatar: profile.avatar } : {}),
			}),
			blueprintId: profile?.blueprintId ?? "leader",
			selected: selectedMemberIds.includes(member.id),
			status: failedMemberIds.has(member.id) ? "error" : workingMembers.has(member.id) ? "working" : "idle",
		};
	});
}

export function projectTeamConversationTimeline({
	snapshot,
	pending,
	streams,
	members,
	labels,
	memberId,
}: {
	readonly snapshot: DesktopTeamSessionSnapshot | undefined;
	readonly pending: TeamPendingRequest | undefined;
	readonly streams: TeamStreamState;
	readonly members: readonly TeamMemberViewModel[];
	readonly labels: TeamTimelineLabels;
	/** When set, render only this member's native conversation inside the Team shell. */
	readonly memberId?: string;
}): ChatConversationItem[] {
	if (!snapshot && !pending) return [];
	const session = snapshot?.session;
	const memberMap = new Map(members.map((member) => [member.id, member]));
	const memberConversations = snapshot?.display?.memberConversations ?? [];
	const visibleMemberConversations = memberId
		? memberConversations.filter((conversation) => conversation.memberId === memberId)
		: memberConversations;
	const projectedMemberItems = visibleMemberConversations.flatMap((conversation) =>
		projectMemberConversation(conversation.memberId, conversation.history),
	);
	const latestProjectedMemberItem = projectedMemberItems.at(-1);
	const liveMemberTurns = Object.values(streams).filter(
		(turn) => turn.message.phase === "streaming" || turn.message.phase === "aborted",
	);
	const consumedLiveMessageIds = new Set<string>();
	// User input is persisted in the coordination conversation before member
	// turns are scheduled. Keep it as the canonical timeline item even when
	// member histories are available. Member Runtime histories contain their own
	// user input entries as execution context; those entries are not user-authored
	// Team messages and never enter either aggregate or member-scoped display.
	const coordinationItems = snapshot ? projectLegacySnapshotMessages(snapshot) : [];
	const coordinationUserItems = coordinationItems.filter((item) => item.kind === "user");
	const userAnnotationsByMessageId = new Map(
		(snapshot?.userMessageAnnotations ?? []).map((annotation) => [annotation.messageEntryId, annotation]),
	);
	const annotatedCoordinationUserItems = coordinationUserItems.map((item) => {
		const annotation = userAnnotationsByMessageId.get(item.entryId ?? item.id);
		return annotation ? { ...item, memberMentions: [...annotation.mentions] } : item;
	});
	const visibleCoordinationUserItems =
		memberId === undefined
			? annotatedCoordinationUserItems
			: annotatedCoordinationUserItems.filter((item) =>
					userAnnotationsByMessageId.get(item.entryId ?? item.id)?.participantIds.includes(memberId),
				);
	const coordinationAgentItems = mergeTeamAgentTurns(
		coordinationItems.filter((item): item is ConversationAgentMessageViewModel => item.kind === "agent"),
	);
	const coordinationDisplayItems = [...visibleCoordinationUserItems, ...coordinationAgentItems].sort(
		(left, right) => itemTimestamp(left) - itemTimestamp(right),
	);
	const consumedPublicRenderKeys = new Set<string>();
	const stabilizedMemberItems = projectedMemberItems.map((item) => {
		if (item.kind !== "agent") return item;
		const publicMatch = coordinationAgentItems.find(
			(candidate) =>
				sameMemberTurnEvidence(item, candidate) &&
				!consumedPublicRenderKeys.has(candidate.renderKey ?? candidate.entryId ?? candidate.id),
		);
		if (publicMatch) {
			const publicRenderKey = publicMatch.renderKey ?? publicMatch.entryId ?? publicMatch.id;
			consumedPublicRenderKeys.add(publicRenderKey);
			return { ...item, renderKey: publicRenderKey };
		}
		if (memberId !== undefined && item === latestProjectedMemberItem) {
			const liveMatch = liveMemberTurns.find(
				(turn) => !consumedLiveMessageIds.has(turn.message.id) && sameMemberTurnEvidence(item, turn.message),
			);
			if (liveMatch) {
				consumedLiveMessageIds.add(liveMatch.message.id);
				return {
					...liveMatch.message,
					id: item.id,
					entryId: item.entryId,
					renderKey: item.renderKey,
				};
			}
		}
		return item;
	});
	const leaderMemberId = session?.leaderMemberId;
	const activities = memberId ? [] : (snapshot?.activities ?? []);
	const leaderDelegations = activities.filter(
		(activity) => activity.sourceMemberId === leaderMemberId && activity.targetMemberId !== leaderMemberId,
	);
	const aggregateCoordinationAgentItems = coordinationAgentItems.filter(
		(item) => !leaderDelegations.some((activity) => matchesActivityReply(activity, item)),
	);
	const projectedItems =
		// The coordination Conversation is the only durable public Team timeline.
		// Member Runtime histories contain private prompts, intermediate responses,
		// and tool continuations whose shape can change after the live turn finishes.
		// They are available only in an explicit member view and never create rows in
		// the aggregate feed, so reopening a session cannot change its presentation.
		memberId === undefined
			? [...annotatedCoordinationUserItems, ...aggregateCoordinationAgentItems]
			: [...visibleCoordinationUserItems, ...stabilizedMemberItems.filter((item) => item.kind !== "user")];
	const linkedPresentations = new Map<string, ChatToolCallPresentationViewModel>();
	// Only suppress the legacy top-level activity card once the originating leader
	// tool is present in the current snapshot/stream. During the short window where
	// activities can arrive before the leader message, keep the legacy projection so
	// the member reply is not temporarily lost.
	const visibleLeaderToolCallIds = new Set(
		[...projectedItems, ...Object.values(streams).map((turn) => turn.message)]
			.filter(
				(item): item is Extract<ChatConversationItem, { kind: "agent" }> =>
					item.kind === "agent" && item.authorId === leaderMemberId,
			)
			.flatMap((item) =>
				item.blocks
					.filter((block): block is Extract<typeof block, { type: "tool_call" }> => block.type === "tool_call")
					.map((block) => block.toolCallId),
			),
	);
	const decorateLeaderMessage = (item: ChatConversationItem): ChatConversationItem => {
		if (item.kind !== "agent" || item.authorId !== leaderMemberId || linkedPresentations.size === 0) return item;
		const presentations = item.blocks
			.filter((block): block is Extract<typeof block, { type: "tool_call" }> => block.type === "tool_call")
			.map((block) => linkedPresentations.get(block.toolCallId))
			.filter((presentation): presentation is ChatToolCallPresentationViewModel => presentation !== undefined);
		return presentations.length > 0 ? { ...item, toolCallPresentations: presentations } : item;
	};
	const projectedIds = new Set(projectedItems.map((item) => item.id));
	const items = dedupeTeamUserItems([
		...projectedItems,
		...coordinationDisplayItems.filter(
			(item) =>
				!projectedIds.has(item.id) &&
				(item.kind === "user" || (memberId !== undefined && memberConversations.length === 0)),
		),
	]);
	const teamMemberSummaries = new Map<string, ChatConversationItem>();
	for (const activity of activities) {
		const source =
			memberMap.get(activity.sourceMemberId)?.name ??
			session?.memberHandles[activity.sourceMemberId] ??
			labels.unknownMember;
		const target =
			memberMap.get(activity.targetMemberId)?.name ??
			session?.memberHandles[activity.targetMemberId] ??
			labels.unknownMember;
		const targetMember = memberMap.get(activity.targetMemberId);
		if (activity.sourceMemberId === leaderMemberId && targetMember && targetMember.id !== leaderMemberId) {
			const linkedToVisibleLeaderTool =
				activity.originToolCallId !== undefined && visibleLeaderToolCallIds.has(activity.originToolCallId);
			const targetMessage = coordinationAgentItems.find(
				(item): item is ConversationAgentMessageViewModel =>
					item.kind === "agent" && matchesActivityReply(activity, item),
			);
			const streamMessage = Object.values(streams)
				.map((turn) => turn.message)
				.find((item) => matchesActivityReply(activity, item));
			const sourceMessage = streamMessage ?? targetMessage;
			const summary = buildTeamMemberReplySummary({
				member: targetMember,
				requestId: activity.requestId,
				// A summary card occupies the activity's original timeline slot for its
				// whole lifecycle. Using the eventual reply timestamp here would reorder
				// cards whenever members complete out of order and make the viewport jump.
				timestamp: activity.timestamp,
				activityState:
					activity.state === "failed"
						? "failed"
						: activity.state === "cancelled"
							? "cancelled"
							: sourceMessage?.phase === "aborted"
								? "cancelled"
								: activity.state === "completed"
									? "completed"
									: activity.state === "waiting"
										? "waiting"
										: sourceMessage
											? "streaming"
											: "pending",
				message: sourceMessage,
			});
			if (summary.kind === "event" && summary.event.kind === "team-member-summary") {
				if (linkedToVisibleLeaderTool && activity.originToolCallId) {
					const existing = linkedPresentations.get(activity.originToolCallId);
					linkedPresentations.set(activity.originToolCallId, {
						toolCallId: activity.originToolCallId,
						activities: [...(existing?.activities ?? []), summary.event],
					});
				} else {
					teamMemberSummaries.set(`${activity.requestId}:${targetMember.id}`, summary);
				}
			}
		}
		if (!activity.originToolCallId || !visibleLeaderToolCallIds.has(activity.originToolCallId)) {
			items.push({
				id: activity.id,
				renderKey: `team:activity:${activity.id}`,
				kind: "event",
				timestamp: activity.timestamp,
				event: {
					kind: "delegation",
					requestId: activity.requestId,
					label: labels.delegation(source, target),
					timestamp: activity.timestamp,
				},
			});
		}
	}
	for (let index = 0; index < items.length; index++) {
		items[index] = decorateLeaderMessage(items[index] as ChatConversationItem);
	}
	items.push(...teamMemberSummaries.values());

	const userCommitted = pending
		? (snapshot?.messages.some((record) => record.kind === "user" && record.turnId === pending.requestId) ?? false) ||
			items.some((item) => item.kind === "user" && item.turnId === pending.requestId)
		: false;
	const pendingUserVisible =
		pending !== undefined && (memberId === undefined || (pending.targetMemberIds?.includes(memberId) ?? false));
	if (pending && pendingUserVisible && !userCommitted) {
		items.push({
			id: `user:${pending.requestId}`,
			renderKey: teamUserTurnRenderKey(pending.requestId),
			turnId: pending.requestId,
			authorId: "local-user",
			kind: "user",
			role: "user",
			deliveryPhase: "pending",
			text: pending.displayText ?? stripAttachmentContext(pending.text),
			...(pending.memberMentions ? { memberMentions: [...pending.memberMentions] } : {}),
			timestamp: pending.timestamp ?? session?.updatedAt ?? Date.now(),
			attachments: [...(pending.attachments ?? [])],
		});
	}

	const persistedAgentItems = items.filter((item) => item.kind === "agent");
	const persistedResults = new Set(persistedAgentItems.map((item) => item.id));
	for (const turn of Object.values(streams).sort(
		(left, right) => (left.message.startedAt ?? 0) - (right.message.startedAt ?? 0),
	)) {
		if (turn.message.phase !== "streaming" && turn.message.phase !== "aborted") continue;
		if (consumedLiveMessageIds.has(turn.message.id)) continue;
		if (memberId && turn.message.authorId !== memberId) continue;
		if (
			!memberId &&
			turn.message.authorId !== leaderMemberId &&
			leaderDelegations.some((activity) => matchesActivityReply(activity, turn.message))
		)
			continue;
		// Runtime history, coordination history, and the live event can assign different
		// message ids to the same member turn. The stable render key is therefore the
		// primary identity while their snapshots overlap; exact text remains a fallback
		// for legacy records without that identity. Empty text is not content evidence,
		// because unrelated tool-only turns all have the same public text.
		const streamText = publicAgentText(turn.message);
		const streamRenderKey = teamAgentTurnRenderKey(turn.message.authorId, turn.message.turnId);
		const persistedIndex = items.findIndex(
			(item) =>
				item.kind === "agent" &&
				(item.id === turn.message.id || (item.renderKey ?? item.entryId ?? item.id) === streamRenderKey),
		);
		if (persistedIndex >= 0) {
			const persisted = items[persistedIndex];
			if (persisted?.kind === "agent" && turn.message.phase === "aborted") {
				items[persistedIndex] = decorateLeaderMessage(
					mergeTeamAgentMessage(persisted, turn.message, streamRenderKey),
				);
			}
			continue;
		}
		if (
			persistedResults.has(turn.message.id) ||
			(streamText.length > 0 &&
				persistedAgentItems.some(
					(item) => item.authorId === turn.message.authorId && publicAgentText(item) === streamText,
				))
		)
			continue;
		items.push(
			decorateLeaderMessage({
				...turn.message,
				renderKey: streamRenderKey,
			}),
		);
	}
	const waitingAuthorIds = pending
		? memberId
			? (
					pending.targetMemberIds?.length
						? pending.targetMemberIds.includes(memberId)
						: memberId === (session?.leaderMemberId ?? pending.leaderMemberId)
				)
				? [memberId]
				: []
			: pending.targetMemberIds?.length
				? [...new Set(pending.targetMemberIds)]
				: [session?.leaderMemberId ?? pending.leaderMemberId ?? "leader"]
		: [];
	for (const waitingAuthorId of waitingAuthorIds) {
		if (!pending) break;
		const waitingRenderKey = teamAgentTurnRenderKey(waitingAuthorId, pending.requestId);
		const responseAlreadyVisible = items.some(
			(item) => item.kind === "agent" && (item.renderKey ?? item.entryId ?? item.id) === waitingRenderKey,
		);
		const responseIsStreaming = Object.values(streams).some(
			(turn) => turn.message.authorId === waitingAuthorId && turn.message.phase === "streaming",
		);
		if (responseAlreadyVisible || responseIsStreaming) continue;
		items.push({
			id: `waiting:${pending.requestId}:${waitingAuthorId}`,
			renderKey: waitingRenderKey,
			turnId: pending.requestId,
			authorId: waitingAuthorId,
			kind: "agent",
			role: "assistant",
			phase: "pending",
			text: "",
			blocks: [],
			timestamp: pending.timestamp ?? session?.updatedAt ?? Date.now(),
		});
	}
	// Pending and live rows are appended after the durable projection above. Sort
	// once more so a Ctrl+Enter request keeps its chronological place instead of
	// being rendered below an older delegation/result card until the next snapshot.
	sortTeamTimelineItems(items);
	return items;
}

function matchesActivityReply(
	activity: DesktopTeamSessionSnapshot["activities"][number],
	item: ConversationAgentMessageViewModel,
): boolean {
	return (
		item.authorId === activity.targetMemberId &&
		(item.turnId === activity.requestId ||
			(activity.sourceTurnId !== undefined && item.turnId === activity.sourceTurnId) ||
			item.id === activity.requestId ||
			item.parentId === activity.requestId)
	);
}

function dedupeTeamUserItems(items: readonly ChatConversationItem[]): ChatConversationItem[] {
	const seenUserIds = new Set<string>();
	const seenTurnIds = new Set<string>();
	return items.filter((item) => {
		if (item.kind !== "user") return true;
		if (seenUserIds.has(item.id) || (item.turnId !== undefined && seenTurnIds.has(item.turnId))) return false;
		seenUserIds.add(item.id);
		if (item.turnId !== undefined) seenTurnIds.add(item.turnId);
		return true;
	});
}

function projectMemberConversation(memberId: string, history: readonly HistoryEntry[]) {
	return fullHistoryToChat([...history]).map((item, index) => {
		const renderKey = `team:member:${memberId}:${index}:${item.entryId ?? item.id}`;
		if (item.kind === "agent") {
			return { ...item, authorId: memberId, renderKey };
		}
		if (item.kind === "user") {
			return { ...item, text: stripAttachmentContext(item.text), renderKey };
		}
		return { ...item, renderKey };
	});
}

/** Compatibility for legacy Team snapshots that predate member histories. */
function projectLegacySnapshotMessages(snapshot: DesktopTeamSessionSnapshot): ChatConversationItem[] {
	const toolExecutions = snapshot.display?.toolExecutions ?? [];
	return snapshot.messages.map((record) => {
		if (record.kind === "user") {
			return {
				id: record.id,
				entryId: record.id,
				renderKey: teamUserTurnRenderKey(record.turnId),
				turnId: record.turnId,
				authorId: record.author.id,
				kind: "user",
				role: "user",
				deliveryPhase: "completed",
				text: stripAttachmentContext(
					typeof record.message.content === "string"
						? record.message.content
						: record.message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
				),
				timestamp: record.timestamp,
				attachments: [...(record.attachments ?? [])],
			};
		}
		const projected = projectConversationAgentMessage({
			message: record.message,
			messageId: record.id,
			entryId: record.id,
			turnId: record.turnId,
			authorId: record.author.id,
			timestamp: record.timestamp,
			executions: toolExecutions,
		});
		const normalized =
			projected.kind === "agent" && (record.message.stopReason === "stop" || record.message.stopReason === "aborted")
				? patchLegacyPendingTools(projected, record.message.stopReason === "aborted")
				: projected;
		return {
			...normalized,
			// Public Team records intentionally omit private tool-result entries.
			// Once the terminal assistant record is persisted, a pending tool block
			// is no longer running and must not render as an endless spinner.
			// The same Team turn moves through waiting, streaming and persisted
			// projections. Keep one DOM identity across every phase so the virtual
			// list updates the row in place instead of visibly reloading it.
			renderKey: teamAgentTurnRenderKey(record.author.id, record.turnId),
		};
	});
}

function patchLegacyPendingTools(
	projected: Extract<ChatConversationItem, { kind: "agent" }>,
	cancelled: boolean,
): Extract<ChatConversationItem, { kind: "agent" }> {
	return {
		...projected,
		blocks: projected.blocks.map((block) =>
			block.type === "tool_call" && block.status === "pending"
				? { ...block, status: cancelled ? ("cancelled" as const) : ("success" as const), currentPhase: undefined }
				: block,
		),
	};
}

function teamUserTurnRenderKey(turnId: string): string {
	return `team:user-turn:${turnId}`;
}

function teamAgentTurnRenderKey(authorId: string, turnId: string): string {
	return `team:agent-turn:${authorId}:${turnId}`;
}

/**
 * The public coordination conversation persists one Agent record per provider
 * step (pre-tool, tool continuation, final text), while the ordinary chat
 * projection renders those records as one assistant turn. Keep the Team feed
 * on that same contract so a completed tool call does not split the leader into
 * multiple bubbles or leave the pre-tool bubble looking active.
 */
function mergeTeamAgentTurns(items: readonly ConversationAgentMessageViewModel[]): ConversationAgentMessageViewModel[] {
	const merged: ConversationAgentMessageViewModel[] = [];
	const indexByTurn = new Map<string, number>();
	for (const item of items) {
		const turnKey = `${item.authorId}\u0000${item.turnId}`;
		const existingIndex = indexByTurn.get(turnKey);
		if (existingIndex === undefined) {
			indexByTurn.set(turnKey, merged.length);
			merged.push({ ...item, blocks: [...item.blocks], usages: item.usages ? [...item.usages] : undefined });
			continue;
		}

		const existing = merged[existingIndex];
		const phase = item.phase;
		const blocks = mergeAgentBlocks(existing.blocks, item.blocks);
		const withTerminalTools =
			phase === "aborted"
				? settlePendingToolCalls({ ...item, blocks }, "cancelled").blocks
				: phase === "completed"
					? settlePendingToolCalls({ ...item, blocks }, "success").blocks
					: blocks;
		merged[existingIndex] = {
			...existing,
			phase,
			blocks: withTerminalTools,
			...(item.text ? { text: existing.text ? `${existing.text}\n${item.text}` : item.text } : {}),
			...(existing.usages || item.usages ? { usages: [...(existing.usages ?? []), ...(item.usages ?? [])] } : {}),
			...(item.startedAt !== undefined && existing.startedAt === undefined ? { startedAt: item.startedAt } : {}),
			...(item.endedAt !== undefined ? { endedAt: item.endedAt } : {}),
			...(item.durationSeconds !== undefined ? { durationSeconds: item.durationSeconds } : {}),
		};
	}
	return merged;
}

function mergeAgentBlocks(
	existing: readonly ConversationAgentMessageViewModel["blocks"][number][],
	incoming: readonly ConversationAgentMessageViewModel["blocks"][number][],
): ConversationAgentMessageViewModel["blocks"] {
	const merged = [...existing];
	const blockIndexes = new Map(merged.map((block, index) => [conversationBlockIdentity(block), index] as const));
	for (const block of incoming) {
		const existingIndex = blockIndexes.get(conversationBlockIdentity(block));
		if (existingIndex === undefined) {
			blockIndexes.set(conversationBlockIdentity(block), merged.length);
			merged.push(block);
			continue;
		}
		const current = merged[existingIndex];
		if (block.type !== "tool_call" || current?.type !== "tool_call") {
			merged[existingIndex] = block;
			continue;
		}
		const status = current.status === "pending" ? block.status : current.status;
		merged[existingIndex] = {
			...current,
			...block,
			toolName: block.toolName || current.toolName,
			args: Object.keys(block.args).length > 0 ? block.args : current.args,
			status,
			...(status === "pending" ? {} : { currentPhase: undefined }),
		};
	}
	return merged;
}

function conversationBlockIdentity(block: ConversationAgentMessageViewModel["blocks"][number]): string {
	switch (block.type) {
		case "tool_call":
			return `tool-call:${block.toolCallId}`;
		case "tool_result":
			return `tool-result:${block.toolCallId}`;
		case "text":
		case "thinking":
		case "error":
			return `${block.type}:${block.id}`;
	}
}

function mergeTeamAgentMessage(
	persisted: ConversationAgentMessageViewModel,
	live: ConversationAgentMessageViewModel,
	renderKey: string,
): ConversationAgentMessageViewModel {
	const blocks = mergeAgentBlocks(persisted.blocks, live.blocks);
	const merged = {
		...persisted,
		phase: live.phase,
		blocks,
		text: mergePublicAgentText(persisted.text, live.text),
		renderKey,
		...(live.startedAt !== undefined ? { startedAt: live.startedAt } : {}),
		...(live.endedAt !== undefined ? { endedAt: live.endedAt } : {}),
		...(live.durationSeconds !== undefined ? { durationSeconds: live.durationSeconds } : {}),
	};
	return live.phase === "aborted" ? settlePendingToolCalls(merged, "cancelled") : merged;
}

function mergePublicAgentText(persisted: string | undefined, live: string | undefined): string | undefined {
	if (!persisted) return live;
	if (!live || persisted === live || persisted.startsWith(live)) return persisted;
	if (live.startsWith(persisted)) return live;
	return `${persisted}\n${live}`;
}

function sortTeamTimelineItems(items: ChatConversationItem[]): void {
	const userTimestampByTurn = new Map(
		items.flatMap((item) => (item.kind === "user" ? [[item.turnId, itemTimestamp(item)] as const] : [])),
	);
	items.sort((left, right) => {
		// A turn is a causal unit. Runtime/provider timestamps can precede the local
		// optimistic timestamp by a few milliseconds, but its reply still follows
		// the user input that started that same turn. Clamp only that early reply to
		// the input timestamp, preserving the order of unrelated concurrent turns.
		const sortTimestamp = (item: ChatConversationItem) => {
			const userTimestamp = item.kind === "agent" ? userTimestampByTurn.get(item.turnId) : undefined;
			return userTimestamp === undefined ? itemTimestamp(item) : Math.max(itemTimestamp(item), userTimestamp);
		};
		const timestampDelta = sortTimestamp(left) - sortTimestamp(right);
		if (timestampDelta !== 0) return timestampDelta;
		if (left.kind === "user" && right.kind !== "user") return -1;
		if (left.kind !== "user" && right.kind === "user") return 1;
		return 0;
	});
}

function itemTimestamp(item: ChatConversationItem): number {
	return item.timestamp ?? 0;
}

function publicAgentText(item: ChatConversationItem): string {
	return item.kind === "agent" ? (item.text ?? "") : "";
}

function sameMemberTurnEvidence(
	persisted: ConversationAgentMessageViewModel,
	live: ConversationAgentMessageViewModel,
): boolean {
	if (persisted.authorId !== live.authorId) return false;
	const persistedToolCallIds = new Set(
		persisted.blocks.flatMap((block) => (block.type === "tool_call" ? [block.toolCallId] : [])),
	);
	if (live.blocks.some((block) => block.type === "tool_call" && persistedToolCallIds.has(block.toolCallId)))
		return true;
	const persistedText = publicAgentText(persisted);
	const liveText = publicAgentText(live);
	return persistedText.length > 0 && persistedText === liveText;
}

export function stripAttachmentContext(text: string): string {
	return text.replace(/\n*<attachments>\n[\s\S]*?\n<\/attachments>\s*$/u, "").trimEnd();
}
