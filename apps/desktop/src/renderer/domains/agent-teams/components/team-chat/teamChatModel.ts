import {
	createMessageFeedNavigationText,
	type MessageFeedNavigationEntry,
	type MessageFeedNavigationLabels,
	type MessageFeedNavigationTurn,
} from "@shared/components/message-feed/navigationModel";
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

export interface TeamMemberViewModel {
	readonly id: string;
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
	readonly phase: "streaming" | "error" | "aborted";
	readonly error?: string;
}

export type TeamStreamState = Readonly<Record<string, TeamStreamingTurnViewModel>>;

export type TeamTimelineItemViewModel =
	| {
			readonly id: string;
			readonly kind: "user";
			readonly requestId: string;
			readonly text: string;
			readonly pending: boolean;
			readonly timestamp: number;
			readonly attachments: readonly PromptAttachmentRef[];
			readonly targetMemberIds: readonly string[];
	  }
	| {
			readonly id: string;
			readonly kind: "member";
			readonly requestId: string;
			readonly member: TeamMemberViewModel;
			readonly text: string;
			readonly pending: boolean;
			readonly timestamp: number;
			readonly error?: string;
	  }
	| {
			readonly id: string;
			readonly kind: "delegation";
			readonly requestId: string;
			readonly label: string;
			readonly timestamp: number;
	  };

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
			phase: event.phase,
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
				kind: "user",
				requestId: event.requestId,
				text: stripAttachmentContext(event.text),
				pending: false,
				timestamp: event.timestamp,
				attachments: event.attachments ?? [],
				targetMemberIds: event.targetMemberIds,
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
				kind: "delegation",
				requestId: event.requestId,
				label: labels.delegation(source, target),
				timestamp: event.timestamp,
			};
		}
		return {
			id: `member:${event.sourceTurnId}`,
			kind: "member",
			requestId: event.requestId,
			member: fallbackMember(event.memberId, session, memberMap, labels.unknownMember),
			text: event.text,
			pending: false,
			timestamp: event.timestamp,
		};
	});

	const userCommitted = pending
		? session.events.some((event) => event.type === "user-message" && event.requestId === pending.requestId)
		: false;
	if (pending && !userCommitted) {
		items.push({
			id: `user:${pending.requestId}`,
			kind: "user",
			requestId: pending.requestId,
			text: pending.displayText ?? stripAttachmentContext(pending.text),
			pending: true,
			timestamp: pending.timestamp ?? session.updatedAt,
			attachments: pending.attachments ?? [],
			targetMemberIds: pending.targetMemberIds ?? [],
		});
	}

	const persistedResults = new Set(
		session.events.filter((event) => event.type === "member-result").map((event) => event.sourceTurnId),
	);
	for (const turn of Object.values(streams).sort((left, right) => left.startedAt - right.startedAt)) {
		if (persistedResults.has(turn.turnId)) continue;
		items.push({
			id: `member:${turn.turnId}`,
			kind: "member",
			requestId: turn.requestId,
			member: fallbackMember(turn.memberId, session, memberMap, labels.unknownMember),
			text: turn.text,
			pending: turn.phase === "streaming",
			timestamp: turn.startedAt,
			...(turn.error ? { error: turn.error } : {}),
		});
	}
	if (pending && Object.keys(streams).length === 0) {
		items.push({
			id: `waiting:${pending.requestId}:${session.leaderMemberId}`,
			kind: "member",
			requestId: pending.requestId,
			member: fallbackMember(session.leaderMemberId, session, memberMap, labels.unknownMember),
			text: "",
			pending: true,
			timestamp: pending.timestamp ?? session.updatedAt,
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
		let turn = byRequest.get(item.requestId);
		if (!turn) {
			turn = {
				id: `team-turn:${item.requestId}`,
				turnNumber: turns.length + 1,
				entries: [],
			};
			turns.push(turn);
			byRequest.set(item.requestId, turn);
		}
		const text = item.kind === "delegation" ? item.label : item.text;
		const navigationText = createMessageFeedNavigationText(text);
		turn.entries.push({
			id: item.id,
			itemIndex,
			preview: navigationText.preview,
			role: item.kind === "user" ? "request" : "response",
			searchText: navigationText.searchText,
			turnNumber: turn.turnNumber,
		});
	}
	return turns;
}

export function stripAttachmentContext(text: string): string {
	return text.replace(/\n*<attachments>\n[\s\S]*?\n<\/attachments>\s*$/u, "").trimEnd();
}

function fallbackMember(
	memberId: string,
	session: TeamSessionDocument,
	members: ReadonlyMap<string, TeamMemberViewModel>,
	unknownMember: string,
): TeamMemberViewModel {
	return (
		members.get(memberId) ?? {
			id: memberId,
			name: session.memberHandles[memberId] ?? unknownMember,
			handle: session.memberHandles[memberId] ?? memberId,
			blueprintId: "leader",
			selected: false,
			status: "idle",
		}
	);
}
