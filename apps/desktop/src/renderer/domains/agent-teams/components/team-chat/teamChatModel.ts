import {
	createMessageFeedNavigationText,
	type MessageFeedNavigationEntry,
	type MessageFeedNavigationLabels,
	type MessageFeedNavigationTurn,
} from "@shared/components/message-feed/navigationModel";
import type {
	ConversationFeedItemViewModel,
	ConversationMessageViewModel,
	ConversationParticipantViewModel,
} from "@shared/conversation";
import type { RendererMarkdownModel } from "@shared/models/renderer-markdown-model";
import type { AgentTeamDocument, TeamDefinition, TeamSessionDocument, TeamSessionStreamEvent } from "@vetta/agent-team";
import type { PromptAttachmentRef } from "@vetta/runtime-core";

export type TeamChatStatus = "loading" | "ready" | "sending" | "streaming" | "cancelling" | "error";

export interface TeamChatLabels {
	readonly loading: string;
	readonly readyTitle: string;
	readonly readyDescription: string;
	readonly leaderRoute: string;
	readonly placeholder: string;
	readonly hint: string;
	readonly send: string;
	readonly stop: string;
	readonly sending: string;
	readonly failed: string;
	readonly retry: string;
	readonly attachFile: string;
	readonly attachImage: string;
	readonly removeAttachment: (name: string) => string;
	readonly copy: string;
	readonly copied: string;
	readonly navigation: MessageFeedNavigationLabels;
}

export interface TeamChatViewModel {
	readonly feedKey: string;
	readonly title: string;
	readonly status: TeamChatStatus;
	readonly draft: string;
	readonly history: readonly string[];
	readonly attachments: readonly TeamAttachmentViewModel[];
	readonly members: readonly TeamMemberViewModel[];
	readonly timelineItems: readonly TeamTimelineItemViewModel[];
	readonly markdown: RendererMarkdownModel;
	readonly error?: string;
	readonly editorEnabled: boolean;
	readonly canSend: boolean;
	readonly labels: TeamChatLabels;
}

export interface TeamChatActions {
	readonly setDraft: (draft: string) => void;
	readonly selectLeader: () => void;
	readonly toggleMember: (memberId: string) => void;
	readonly selectFiles: () => Promise<void>;
	readonly selectImages: () => Promise<void>;
	readonly removeAttachment: (path: string) => void;
	readonly send: () => Promise<void>;
	readonly abort: () => Promise<void>;
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

export interface TeamStreamingTurnViewModel {
	readonly turnId: string;
	readonly requestId: string;
	readonly memberId: string;
	readonly seq: number;
	readonly text: string;
	readonly startedAt: number;
	readonly phase: "streaming" | "waiting" | "error" | "aborted";
	readonly error?: string;
}

export type TeamStreamState = Readonly<Record<string, TeamStreamingTurnViewModel>>;

export interface TeamTimelineEventViewModel {
	readonly kind: "delegation";
	readonly requestId: string;
	readonly label: string;
	readonly timestamp: number;
}

export type TeamTimelineItemViewModel = ConversationFeedItemViewModel<TeamTimelineEventViewModel>;

export interface TeamTimelineLabels {
	readonly delegation: (from: string, to: string) => string;
	readonly unknownMember: string;
}

export function reduceTeamStreamState(state: TeamStreamState, event: TeamSessionStreamEvent): TeamStreamState {
	if (event.type === "session-snapshot") {
		return Object.fromEntries(
			event.activeTurns.map((turn) => [
				turn.turnId,
				{
					...turn,
					phase: "streaming" as const,
				},
			]),
		);
	}
	if (event.type === "session-updated") return state;
	if (event.type === "member-start") {
		return {
			...state,
			[event.turnId]: {
				turnId: event.turnId,
				requestId: event.requestId,
				memberId: event.memberId,
				seq: event.seq,
				text: "",
				startedAt: event.timestamp,
				phase: "streaming",
			},
		};
	}
	const current = state[event.turnId];
	if (!current || event.seq <= current.seq) return state;
	if (event.type === "member-delta") {
		return {
			...state,
			[event.turnId]: {
				...current,
				seq: event.seq,
				text: `${current.text}${event.delta}`,
			},
		};
	}
	if (event.phase === "final" || event.phase === "aborted") {
		const next = { ...state };
		delete next[event.turnId];
		return next;
	}
	return {
		...state,
		[event.turnId]: {
			...current,
			seq: event.seq,
			phase: event.phase === "attention-required" ? "error" : event.phase,
			...(event.error ? { error: event.error } : {}),
		},
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
			.filter((turn) => turn.phase === "streaming")
			.map((turn) => turn.memberId),
	);
	const errorMembers = new Set(
		Object.values(streams)
			.filter((turn) => turn.phase === "error")
			.map((turn) => turn.memberId),
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
			status: errorMembers.has(member.id) ? "error" : workingMembers.has(member.id) ? "working" : "idle",
		};
	});
}

export function buildTeamTimelineItems({
	session,
	pending,
	streams,
	members,
	labels,
}: {
	readonly session: TeamSessionDocument | undefined;
	readonly pending: TeamPendingRequest | undefined;
	readonly streams: TeamStreamState;
	readonly members: readonly TeamMemberViewModel[];
	readonly labels: TeamTimelineLabels;
}): TeamTimelineItemViewModel[] {
	if (!session) return [];
	const memberMap = new Map(members.map((member) => [member.id, member]));
	const items: TeamTimelineItemViewModel[] = session.events.map((event) => {
		if (event.type === "user-message") {
			return {
				id: `user:${event.requestId}`,
				kind: "message",
				message: {
					id: `user:${event.requestId}`,
					turnId: event.requestId,
					authorId: "local-user",
					kind: "user",
					role: "user",
					deliveryPhase: "completed",
					text: stripAttachmentContext(event.text),
					timestamp: event.timestamp,
					attachments: event.attachments ?? [],
				},
			};
		}
		if (event.type === "member-delegation") {
			const source =
				memberMap.get(event.sourceMemberId)?.name ??
				session.memberHandles[event.sourceMemberId] ??
				labels.unknownMember;
			const target =
				memberMap.get(event.targetMemberId)?.name ??
				session.memberHandles[event.targetMemberId] ??
				labels.unknownMember;
			return {
				id: event.id,
				kind: "event",
				event: {
					kind: "delegation",
					requestId: event.requestId,
					label: labels.delegation(source, target),
					timestamp: event.timestamp,
				},
			};
		}
		return {
			id: `member:${event.sourceTurnId}`,
			kind: "message",
			message: {
				id: `member:${event.sourceTurnId}`,
				turnId: event.requestId,
				authorId: event.memberId,
				kind: "agent",
				role: "assistant",
				phase: "completed",
				blocks: [{ type: "text", id: `text:${event.id}`, text: event.text }],
				timestamp: event.timestamp,
			},
		};
	});

	const userCommitted = pending
		? session.events.some((event) => event.type === "user-message" && event.requestId === pending.requestId)
		: false;
	if (pending && !userCommitted) {
		items.push({
			id: `user:${pending.requestId}`,
			kind: "message",
			message: {
				id: `user:${pending.requestId}`,
				turnId: pending.requestId,
				authorId: "local-user",
				kind: "user",
				role: "user",
				deliveryPhase: "pending",
				text: pending.displayText ?? stripAttachmentContext(pending.text),
				timestamp: pending.timestamp ?? session.updatedAt,
				attachments: pending.attachments ?? [],
			},
		});
	}

	const persistedResults = new Set(
		session.events.filter((event) => event.type === "member-result").map((event) => event.sourceTurnId),
	);
	for (const turn of Object.values(streams).sort((left, right) => left.startedAt - right.startedAt)) {
		if (persistedResults.has(turn.turnId)) continue;
		items.push({
			id: `member:${turn.turnId}`,
			kind: "message",
			message: {
				id: `member:${turn.turnId}`,
				turnId: turn.requestId,
				authorId: turn.memberId,
				kind: "agent",
				role: "assistant",
				phase: turn.phase === "error" ? "failed" : turn.phase,
				blocks: [
					...(turn.text ? [{ type: "text" as const, id: `text:${turn.turnId}`, text: turn.text }] : []),
					...(turn.error ? [{ type: "text" as const, id: `error:${turn.turnId}`, text: turn.error }] : []),
				],
				timestamp: turn.startedAt,
			},
		});
	}
	if (pending && Object.keys(streams).length === 0) {
		items.push({
			id: `waiting:${pending.requestId}:${session.leaderMemberId}`,
			kind: "message",
			message: {
				id: `waiting:${pending.requestId}:${session.leaderMemberId}`,
				turnId: pending.requestId,
				authorId: session.leaderMemberId,
				kind: "agent",
				role: "assistant",
				phase: "pending",
				blocks: [],
				timestamp: pending.timestamp ?? session.updatedAt,
			},
		});
	}
	return items;
}

/** Team adapter: one user request and all member/delegation events sharing requestId form a turn. */
export function buildTeamNavigationTurns(items: readonly TeamTimelineItemViewModel[]): MessageFeedNavigationTurn[] {
	const turns: Array<{ id: string; turnNumber: number; entries: MessageFeedNavigationEntry[] }> = [];
	const byRequest = new Map<string, (typeof turns)[number]>();
	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		const item = items[itemIndex];
		const requestId = item.kind === "message" ? item.message.turnId : item.event.requestId;
		let turn = byRequest.get(requestId);
		if (!turn) {
			turn = {
				id: `team-turn:${requestId}`,
				turnNumber: turns.length + 1,
				entries: [],
			};
			turns.push(turn);
			byRequest.set(requestId, turn);
		}
		const text = item.kind === "event" ? item.event.label : conversationViewModelText(item.message);
		const navigationText = createMessageFeedNavigationText(text);
		turn.entries.push({
			id: item.id,
			itemIndex,
			preview: navigationText.preview,
			role: item.kind === "message" && item.message.kind === "user" ? "request" : "response",
			searchText: navigationText.searchText,
			turnNumber: turn.turnNumber,
		});
	}
	return turns;
}

export function stripAttachmentContext(text: string): string {
	return text.replace(/\n*<attachments>\n[\s\S]*?\n<\/attachments>\s*$/u, "").trimEnd();
}

function conversationViewModelText(message: ConversationMessageViewModel): string {
	if (message.kind === "user") return message.text;
	return message.blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}
