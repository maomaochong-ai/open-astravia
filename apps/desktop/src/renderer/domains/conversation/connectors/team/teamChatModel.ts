import type {
	DesktopTeamSessionSnapshot,
	DesktopTeamSessionStreamEvent,
} from "@preload/api-types/team-conversation-display";
import { agentAvatarUrl } from "@shared/agent-teams/agent-avatar";
import type { ConversationMessageEventState, ConversationParticipantViewModel } from "@shared/conversation";
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
	readonly timestamp?: number;
}

export type TeamStreamState = Readonly<Record<string, ConversationMessageEventState>>;

export interface TeamTimelineEventViewModel {
	readonly kind: "delegation";
	readonly requestId: string;
	readonly label: string;
	readonly timestamp: number;
}

export interface TeamTimelineLabels {
	readonly delegation: (from: string, to: string) => string;
	readonly unknownMember: string;
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
		const next = { ...state };
		delete next[event.messageId];
		return next;
	}
	if (event.type === "desktop.team-tool-execution" || event.type === "conversation.tool-execution") {
		const current = state[event.messageId];
		const next = reduceConversationToolExecutionEvent(current, event);
		return { ...state, [event.messageId]: next };
	}
	if (event.type === "desktop.team-context-usage") return state;
	const current = state[event.messageId];
	const next = reduceConversationMessageEvent(current, event);
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
	if (!snapshot) return [];
	const { session } = snapshot;
	const memberMap = new Map(members.map((member) => [member.id, member]));
	const memberConversations = snapshot.display?.memberConversations ?? [];
	const visibleMemberConversations = memberId
		? memberConversations.filter((conversation) => conversation.memberId === memberId)
		: memberConversations;
	const projectedItems: ChatConversationItem[] = visibleMemberConversations.flatMap((conversation) =>
		projectMemberConversation(conversation.memberId, conversation.history),
	);
	// User input is persisted in the coordination conversation before member
	// turns are scheduled. Keep it as the canonical timeline item even when
	// member histories are available (they may not contain the prompt yet, and
	// each member can otherwise duplicate the same user turn).
	const legacyItems = projectLegacySnapshotMessages(snapshot);
	const items = dedupeTeamUserItems([
		...projectedItems,
		...(memberConversations.length === 0 ? legacyItems : legacyItems.filter((item) => item.kind === "user")),
	]);
	for (const activity of memberId ? [] : snapshot.activities) {
		const source =
			memberMap.get(activity.sourceMemberId)?.name ??
			session.memberHandles[activity.sourceMemberId] ??
			labels.unknownMember;
		const target =
			memberMap.get(activity.targetMemberId)?.name ??
			session.memberHandles[activity.targetMemberId] ??
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
	}
	items.sort((left, right) => itemTimestamp(left) - itemTimestamp(right));

	const userCommitted = pending
		? snapshot.messages.some((record) => record.kind === "user" && record.turnId === pending.requestId) ||
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
			timestamp: pending.timestamp ?? session.updatedAt,
			attachments: [...(pending.attachments ?? [])],
		});
	}

	const persistedResults = new Set(
		visibleMemberConversations.length > 0
			? visibleMemberConversations.flatMap((conversation) =>
					fullHistoryToChat([...conversation.history]).map((item) => item.id),
				)
			: memberId
				? []
				: snapshot.messages.map((record) => record.id),
	);
	for (const turn of Object.values(streams).sort(
		(left, right) => (left.message.startedAt ?? 0) - (right.message.startedAt ?? 0),
	)) {
		if (memberId && turn.message.authorId !== memberId) continue;
		if (persistedResults.has(turn.message.id)) continue;
		items.push({
			...turn.message,
			renderKey: `team:stream:${turn.message.authorId}:${turn.message.id}`,
		});
	}
	if (pending && Object.keys(streams).length === 0) {
		items.push({
			id: `waiting:${pending.requestId}:${memberId ?? session.leaderMemberId}`,
			renderKey: `team:waiting:${pending.requestId}:${memberId ?? session.leaderMemberId}`,
			turnId: pending.requestId,
			authorId: memberId ?? session.leaderMemberId,
			kind: "agent",
			role: "assistant",
			phase: "pending",
			text: "",
			blocks: [],
			timestamp: pending.timestamp ?? session.updatedAt,
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
		return projectConversationAgentMessage({
			message: record.message,
			messageId: record.id,
			entryId: record.id,
			turnId: record.turnId,
			authorId: record.author.id,
			timestamp: record.timestamp,
		});
	});
}

function itemTimestamp(item: ChatConversationItem): number {
	return item.timestamp ?? 0;
}

export function stripAttachmentContext(text: string): string {
	return text.replace(/\n*<attachments>\n[\s\S]*?\n<\/attachments>\s*$/u, "").trimEnd();
}
