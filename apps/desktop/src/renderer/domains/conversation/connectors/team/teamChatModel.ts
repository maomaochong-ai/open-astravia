import type { ConversationMessageEventState, ConversationParticipantViewModel } from "@shared/conversation";
import { projectAssistantMessageBlocks, reduceConversationMessageEvent } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/atoms";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { AgentTeamDocument, TeamDefinition, TeamSessionSnapshot, TeamSessionStreamEvent } from "@vetta/agent-team";
import type { PromptAttachmentRef } from "@vetta/runtime-core";

export type TeamChatStatus = "loading" | "ready" | "sending" | "streaming" | "cancelling" | "error";

export interface TeamChatLabels {
	readonly leaderRoute: string;
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
	readonly feedItems: readonly ChatConversationItem[];
	readonly error?: string;
	readonly editorEnabled: boolean;
	readonly canSend: boolean;
	readonly workspace: ActivityWorkspace | null;
	readonly activeSessionId: string | null;
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

export function reduceTeamStreamState(state: TeamStreamState, event: TeamSessionStreamEvent): TeamStreamState {
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
			...(profile?.avatar ? { avatar: profile.avatar } : {}),
			blueprintId: profile?.blueprintId ?? "leader",
			selected: selectedMemberIds.includes(member.id),
			status: workingMembers.has(member.id) ? "working" : "idle",
		};
	});
}

export function projectTeamConversationTimeline({
	snapshot,
	pending,
	streams,
	members,
	labels,
}: {
	readonly snapshot: TeamSessionSnapshot | undefined;
	readonly pending: TeamPendingRequest | undefined;
	readonly streams: TeamStreamState;
	readonly members: readonly TeamMemberViewModel[];
	readonly labels: TeamTimelineLabels;
}): ChatConversationItem[] {
	if (!snapshot) return [];
	const { session } = snapshot;
	const memberMap = new Map(members.map((member) => [member.id, member]));
	const items: ChatConversationItem[] = snapshot.messages.map((record) => {
		if (record.kind === "user") {
			return {
				id: record.id,
				entryId: record.id,
				turnId: record.turnId,
				authorId: record.author.id,
				kind: "user",
				role: "user",
				deliveryPhase: "completed",
				text: stripAttachmentContext(userMessageText(record.message.content)),
				timestamp: record.timestamp,
				attachments: [...(record.attachments ?? [])],
			};
		}
		const blocks = projectAssistantMessageBlocks(record.message, record.id, "success").filter(
			(block) => block.type !== "thinking",
		);
		return {
			id: record.id,
			entryId: record.id,
			turnId: record.turnId,
			authorId: record.author.id,
			kind: "agent",
			role: "assistant",
			phase: "completed",
			text: blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"),
			blocks,
			usages: [record.message.usage],
			timestamp: record.timestamp,
		};
	});
	for (const activity of snapshot.activities) {
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
		? snapshot.messages.some((record) => record.kind === "user" && record.turnId === pending.requestId)
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

	const persistedResults = new Set(snapshot.messages.map((record) => record.id));
	for (const turn of Object.values(streams).sort(
		(left, right) => (left.message.startedAt ?? 0) - (right.message.startedAt ?? 0),
	)) {
		if (persistedResults.has(turn.message.id)) continue;
		items.push({
			...turn.message,
		});
	}
	if (pending && Object.keys(streams).length === 0) {
		items.push({
			id: `waiting:${pending.requestId}:${session.leaderMemberId}`,
			turnId: pending.requestId,
			authorId: session.leaderMemberId,
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

function userMessageText(content: string | readonly { readonly type: string; readonly text?: string }[]): string {
	if (typeof content === "string") return content;
	return content.flatMap((block) => (block.type === "text" && block.text ? [block.text] : [])).join("\n");
}

function itemTimestamp(item: ChatConversationItem): number {
	return item.timestamp ?? 0;
}

export function stripAttachmentContext(text: string): string {
	return text.replace(/\n*<attachments>\n[\s\S]*?\n<\/attachments>\s*$/u, "").trimEnd();
}
