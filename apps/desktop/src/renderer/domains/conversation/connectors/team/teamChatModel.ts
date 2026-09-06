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
import { reduceConversationMessageEvent } from "@shared/conversation";
import type { ChatConversationItem, ContextUsageData } from "@shared/store/atoms";
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
	readonly history: readonly string[];
	readonly attachments: readonly TeamAttachmentViewModel[];
	readonly members: readonly TeamMemberViewModel[];
	readonly leaderMemberId?: string;
	readonly feedItems: readonly ChatConversationItem[];
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
	readonly setDraft: (draft: string) => void;
	readonly selectLeader: () => void;
	readonly toggleMember: (memberId: string) => void;
	readonly selectFiles: () => Promise<void>;
	readonly selectImages: () => Promise<void>;
	readonly removeAttachment: (path: string) => void;
	readonly addAttachments: (attachments: readonly TeamAttachmentViewModel[]) => void;
	readonly send: () => Promise<void>;
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
		return event.activeMessageEvents.reduce(reduceTeamStreamState, {});
	}
	if (event.type === "session-updated") {
		const persisted = new Set(event.snapshot.messages.map((record) => record.id));
		return Object.fromEntries(Object.entries(state).filter(([messageId]) => !persisted.has(messageId)));
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
		const next = { ...state };
		delete next[event.messageId];
		return next;
	}
	if (event.type === "desktop.team-tool-execution" || event.type === "conversation.tool-execution") {
		const current = state[event.messageId];
		if (current?.message.phase === "completed") return state;
		const next = reduceConversationToolExecutionEvent(current, event);
		if (next === current) return state;
		return { ...state, [event.messageId]: next };
	}
	if (event.type === "desktop.team-context-usage") return state;
	const current = state[event.messageId];
	const next = reduceConversationMessageEvent(current, event);
	if (next === current) return state;
	return {
		...state,
		[event.messageId]: next,
	};
}

export function resolveTeamMembers(
	document: AgentTeamDocument | undefined,
	team: TeamDefinition | undefined,
	selectedMemberIds: readonly string[],
	streams: TeamStreamState,
	resolveName: (profileId: string, fallbackHandle: string) => string,
	failedMemberIds: ReadonlySet<string> = new Set(),
): TeamMemberViewModel[] {
	if (!team) return [];
	const workingMembers = new Set(
		Object.values(streams)
			.filter((turn) => turn.message.phase === "streaming")
			.map((turn) => turn.message.authorId),
	);
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
	// User input is persisted in the coordination conversation before member
	// turns are scheduled. Keep it as the canonical timeline item even when
	// member histories are available. Member Runtime histories contain their own
	// user input entries as execution context; those entries are not public Team
	// messages and must not be merged into the aggregate feed.
	const coordinationItems = snapshot ? projectLegacySnapshotMessages(snapshot) : [];
	const coordinationUserItems = coordinationItems.filter((item) => item.kind === "user");
	const coordinationAgentItems = mergeTeamAgentTurns(
		coordinationItems.filter((item): item is ConversationAgentMessageViewModel => item.kind === "agent"),
	);
	const coordinationDisplayItems = [...coordinationUserItems, ...coordinationAgentItems].sort(
		(left, right) => itemTimestamp(left) - itemTimestamp(right),
	);
	const stabilizedMemberItems = projectedMemberItems.map((item) => {
		if (item.kind !== "agent") return item;
		const publicMatch = coordinationAgentItems.find(
			(candidate) => candidate.authorId === item.authorId && publicAgentText(candidate) === publicAgentText(item),
		);
		return publicMatch ? { ...item, renderKey: publicMatch.renderKey } : item;
	});
	const memberAgentItems = stabilizedMemberItems.filter((item) => item.kind === "agent");
	const leaderMemberId = session?.leaderMemberId;
	const leaderMemberItems = memberAgentItems.filter((item) => item.authorId === leaderMemberId);
	const leaderCoordinationItems = coordinationAgentItems.filter((item) => item.authorId === leaderMemberId);
	const projectedItems =
		// The coordination Conversation is the durable public Team timeline. Member
		// histories are allowed to lag behind it while the Runtime flushes its last
		// assistant entry; preferring them here would briefly remove the just-published
		// answer (and force the virtualizer to replace the streaming row). Keep native
		// member history for member-scoped views, but use public coordination messages
		// for the aggregate Team feed as soon as one is available.
		memberId === undefined
			? [
					...coordinationUserItems,
					...(leaderCoordinationItems.length > leaderMemberItems.length
						? leaderCoordinationItems
						: leaderMemberItems),
				]
			: coordinationUserItems.length > 0
				? stabilizedMemberItems.filter((item) => item.kind !== "user")
				: stabilizedMemberItems;
	const projectedIds = new Set(projectedItems.map((item) => item.id));
	const items = dedupeTeamUserItems([
		...projectedItems,
		...coordinationDisplayItems.filter(
			(item) => !projectedIds.has(item.id) && (memberConversations.length === 0 || item.kind === "user"),
		),
	]);
	const teamMemberSummaries = new Map<string, ChatConversationItem>();
	for (const activity of memberId ? [] : (snapshot?.activities ?? [])) {
		const source =
			memberMap.get(activity.sourceMemberId)?.name ??
			session?.memberHandles[activity.sourceMemberId] ??
			labels.unknownMember;
		const target =
			memberMap.get(activity.targetMemberId)?.name ??
			session?.memberHandles[activity.targetMemberId] ??
			labels.unknownMember;
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
		const targetMember = memberMap.get(activity.targetMemberId);
		if (targetMember && targetMember.id !== leaderMemberId) {
			const sourceTurnId = activity.sourceTurnId;
			const matchesActivity = (item: ConversationAgentMessageViewModel) =>
				item.authorId === targetMember.id &&
				(item.turnId === activity.requestId ||
					(sourceTurnId !== undefined && item.turnId === sourceTurnId) ||
					item.id === activity.requestId ||
					item.parentId === activity.requestId);
			const targetMessage = [...coordinationAgentItems, ...memberAgentItems].find(
				(item): item is ConversationAgentMessageViewModel => item.kind === "agent" && matchesActivity(item),
			);
			const streamMessage = Object.values(streams)
				.map((turn) => turn.message)
				.find(matchesActivity);
			const sourceMessage = streamMessage ?? targetMessage;
			const summaryKey = `${activity.requestId}:${targetMember.id}`;
			teamMemberSummaries.set(
				summaryKey,
				buildTeamMemberReplySummary({
					member: targetMember,
					requestId: activity.requestId,
					// A summary card occupies the activity's original timeline slot for its
					// whole lifecycle. Using the eventual reply timestamp here reordered the
					// fixed-height cards whenever members completed out of order, which made
					// the message viewport visibly jump even though the DOM keys were stable.
					timestamp: activity.timestamp,
					activityState:
						activity.state === "failed"
							? "failed"
							: activity.state === "cancelled"
								? "cancelled"
								: activity.state === "completed"
									? "completed"
									: activity.state === "waiting"
										? "waiting"
										: sourceMessage
											? "streaming"
											: "pending",
					message: sourceMessage,
				}),
			);
		}
	}
	if (!memberId) {
		for (const turn of Object.values(streams)) {
			if (turn.message.phase !== "streaming" || turn.message.authorId === leaderMemberId) continue;
			const targetMember = memberMap.get(turn.message.authorId);
			if (!targetMember) continue;
			const summaryKey = `${turn.message.turnId}:${targetMember.id}`;
			const existing = teamMemberSummaries.get(summaryKey);
			if (existing?.kind === "event" && existing.event.kind === "team-member-summary" && existing.event.current)
				continue;
			teamMemberSummaries.set(
				summaryKey,
				buildTeamMemberReplySummary({
					member: targetMember,
					requestId: turn.message.turnId,
					timestamp: turn.message.timestamp ?? turn.message.startedAt ?? 0,
					activityState: "streaming",
					message: turn.message,
				}),
			);
		}
	}
	if (!memberId) {
		const activityMemberIds = new Set((snapshot?.activities ?? []).map((activity) => activity.targetMemberId));
		for (const item of memberAgentItems) {
			if (item.authorId === leaderMemberId || activityMemberIds.has(item.authorId)) continue;
			const targetMember = memberMap.get(item.authorId);
			if (!targetMember) continue;
			const summaryKey = `${item.turnId}:${targetMember.id}`;
			if (teamMemberSummaries.has(summaryKey)) continue;
			teamMemberSummaries.set(
				summaryKey,
				buildTeamMemberReplySummary({
					member: targetMember,
					requestId: item.turnId,
					timestamp: item.timestamp ?? 0,
					activityState:
						item.phase === "failed"
							? "failed"
							: item.phase === "aborted"
								? "cancelled"
								: item.phase === "completed"
									? "completed"
									: "streaming",
					message: item,
				}),
			);
		}
	}
	items.push(...teamMemberSummaries.values());
	items.sort((left, right) => itemTimestamp(left) - itemTimestamp(right));

	const userCommitted = pending
		? (snapshot?.messages.some((record) => record.kind === "user" && record.turnId === pending.requestId) ?? false) ||
			items.some((item) => item.kind === "user" && item.turnId === pending.requestId)
		: false;
	if (pending && !userCommitted) {
		items.push({
			id: `user:${pending.requestId}`,
			turnId: pending.requestId,
			authorId: "local-user",
			kind: "user",
			role: "user",
			deliveryPhase: "pending",
			text: pending.displayText ?? stripAttachmentContext(pending.text),
			timestamp: pending.timestamp ?? session?.updatedAt ?? Date.now(),
			attachments: [...(pending.attachments ?? [])],
		});
	}

	const persistedAgentItems = projectedItems.filter((item) => item.kind === "agent");
	const persistedResults = new Set(persistedAgentItems.map((item) => item.id));
	for (const turn of Object.values(streams).sort(
		(left, right) => (left.message.startedAt ?? 0) - (right.message.startedAt ?? 0),
	)) {
		if (turn.message.phase !== "streaming") continue;
		if (memberId && turn.message.authorId !== memberId) continue;
		if (!memberId && turn.message.authorId !== leaderMemberId) continue;
		if (
			persistedResults.has(turn.message.id) ||
			persistedAgentItems.some(
				(item) =>
					item.authorId === turn.message.authorId && publicAgentText(item) === publicAgentText(turn.message),
			)
		)
			continue;
		items.push({
			...turn.message,
			renderKey: `team:stream:${turn.message.authorId}:${turn.message.id}`,
		});
	}
	if (pending && Object.keys(streams).length === 0) {
		items.push({
			id: `waiting:${pending.requestId}:${memberId ?? session?.leaderMemberId ?? pending.leaderMemberId ?? "leader"}`,
			renderKey: `team:waiting:${pending.requestId}:${memberId ?? session?.leaderMemberId ?? pending.leaderMemberId ?? "leader"}`,
			turnId: pending.requestId,
			authorId: memberId ?? session?.leaderMemberId ?? pending.leaderMemberId ?? "leader",
			kind: "agent",
			role: "assistant",
			phase: "pending",
			text: "",
			blocks: [],
			timestamp: pending.timestamp ?? session?.updatedAt ?? Date.now(),
		});
	}
	return items;
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
	return snapshot.messages.map((record) => {
		if (record.kind === "user") {
			return {
				id: record.id,
				entryId: record.id,
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
		});
		return {
			...projected,
			// Public Team records intentionally omit private tool-result entries.
			// Once the terminal assistant record is persisted, a pending tool block
			// is no longer running and must not render as an endless spinner.
			...(record.message.stopReason === "stop" && "blocks" in projected
				? {
						blocks: (projected.blocks as readonly any[]).map((block) =>
							block.type === "tool_call" && block.status === "pending"
								? { ...block, status: "success" as const }
								: block,
						),
					}
				: {}),
			// Keep the DOM identity of a public result stable while it transitions
			// from the live Team stream to the persisted coordination record.
			renderKey: `team:stream:${record.author.id}:${record.id}`,
		};
	});
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
		const blocks = [...existing.blocks, ...item.blocks].map((block) =>
			phase === "completed" && block.type === "tool_call" && block.status === "pending"
				? { ...block, status: "success" as const }
				: block,
		);
		merged[existingIndex] = {
			...existing,
			phase,
			blocks,
			...(item.text ? { text: existing.text ? `${existing.text}\n${item.text}` : item.text } : {}),
			...(existing.usages || item.usages ? { usages: [...(existing.usages ?? []), ...(item.usages ?? [])] } : {}),
			...(item.startedAt !== undefined && existing.startedAt === undefined ? { startedAt: item.startedAt } : {}),
			...(item.endedAt !== undefined ? { endedAt: item.endedAt } : {}),
			...(item.durationSeconds !== undefined ? { durationSeconds: item.durationSeconds } : {}),
		};
	}
	return merged;
}

function itemTimestamp(item: ChatConversationItem): number {
	return item.timestamp ?? 0;
}

function publicAgentText(item: ChatConversationItem): string {
	return item.kind === "agent" ? (item.text ?? "") : "";
}

export function stripAttachmentContext(text: string): string {
	return text.replace(/\n*<attachments>\n[\s\S]*?\n<\/attachments>\s*$/u, "").trimEnd();
}
