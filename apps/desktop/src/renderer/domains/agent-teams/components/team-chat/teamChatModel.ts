import type { RendererMarkdownModel } from "@shared/models/renderer-markdown-model";
import type { AgentTeamDocument, TeamDefinition, TeamSessionDocument, TeamSessionStreamEvent } from "@vetta/agent-team";

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
}

export interface TeamChatViewModel {
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
	| { readonly id: string; readonly kind: "user"; readonly text: string; readonly pending: boolean }
	| {
			readonly id: string;
			readonly kind: "member";
			readonly member: TeamMemberViewModel;
			readonly text: string;
			readonly pending: boolean;
			readonly error?: string;
	  }
	| { readonly id: string; readonly kind: "delegation"; readonly label: string };

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
			return { id: event.id, kind: "user", text: stripAttachmentContext(event.text), pending: false };
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
			return { id: event.id, kind: "delegation", label: labels.delegation(source, target) };
		}
		return {
			id: event.id,
			kind: "member",
			member: fallbackMember(event.memberId, session, memberMap, labels.unknownMember),
			text: event.text,
			pending: false,
		};
	});

	const userCommitted = pending
		? session.events.some((event) => event.type === "user-message" && event.requestId === pending.requestId)
		: false;
	if (pending && !userCommitted) {
		items.push({
			id: `pending:${pending.requestId}`,
			kind: "user",
			text: pending.displayText ?? stripAttachmentContext(pending.text),
			pending: true,
		});
	}

	const persistedResults = new Set(
		session.events
			.filter((event) => event.type === "member-result")
			.map((event) => `${event.requestId}:${event.memberId}`),
	);
	for (const turn of Object.values(streams).sort((left, right) => left.startedAt - right.startedAt)) {
		if (persistedResults.has(`${turn.requestId}:${turn.memberId}`)) continue;
		items.push({
			id: `stream:${turn.turnId}`,
			kind: "member",
			member: fallbackMember(turn.memberId, session, memberMap, labels.unknownMember),
			text: turn.text,
			pending: turn.phase === "streaming",
			...(turn.error ? { error: turn.error } : {}),
		});
	}
	if (pending && Object.keys(streams).length === 0) {
		items.push({
			id: `waiting:${pending.requestId}`,
			kind: "member",
			member: fallbackMember(session.leaderMemberId, session, memberMap, labels.unknownMember),
			text: "",
			pending: true,
		});
	}
	return items;
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
