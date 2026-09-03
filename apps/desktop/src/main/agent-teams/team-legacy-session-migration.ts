import {
	isTeamLegacyEventsMigrationRecord,
	isTeamWorkItem,
	type LegacyTeamFeedEvent,
	stableTeamEventId,
	type TeamConversationBindingRecord,
	type TeamLegacyEventsMigrationRecord,
	type TeamMessageRoutingRecord,
	type TeamSessionDocument,
	type TeamWorkItem,
} from "@vetta/agent-team";
import { createAssistantMessage } from "@vetta/ai";
import type { ConversationDocument } from "@vetta/runtime-core";
import type { ConversationMessageRecord } from "@vetta/runtime-core/conversation";

export interface TeamLegacySessionMigrationPort {
	readDocument(sessionId: string): ConversationDocument;
	appendMessage(sessionId: string, message: ConversationMessageRecord): Promise<{ readonly entryId: string }>;
	appendMetadata(sessionId: string, customType: string, data: unknown): Promise<void>;
}

export async function ensureTeamConversationBinding(
	session: TeamSessionDocument,
	port: TeamLegacySessionMigrationPort,
): Promise<void> {
	const coordination = session.coordinationRuntime;
	if (!coordination) throw new Error("Team coordination conversation is unavailable");
	const binding: TeamConversationBindingRecord = {
		customType: "agent-team.binding.v1",
		teamId: session.teamId,
		teamRevision: session.teamRevision ?? 0,
		coordinationConversationId: coordination.sessionId,
		participants: Object.entries(session.memberRuntime)
			.map(([participantId, runtime]) => ({
				participantId,
				conversationId: runtime.sessionId,
				role: participantId === session.leaderMemberId ? ("leader" as const) : ("member" as const),
			}))
			.sort((left, right) => left.participantId.localeCompare(right.participantId)),
	};
	const existing = latestCustomRecord(port.readDocument(coordination.sessionId), binding.customType);
	if (existing !== undefined && sameBinding(existing, binding)) return;
	await port.appendMetadata(coordination.sessionId, binding.customType, binding);
}

/**
 * Imports schema-v1 Team events into the ordinary coordination Conversation.
 * The caller persists the returned empty-events session only after this function
 * has written and revalidated the completion marker.
 */
export async function migrateLegacyTeamSessionEvents(
	session: TeamSessionDocument,
	port: TeamLegacySessionMigrationPort,
	now: () => number = Date.now,
): Promise<{ readonly session: TeamSessionDocument; readonly migrated: boolean }> {
	const coordination = session.coordinationRuntime;
	if (!coordination) throw new Error("Team coordination conversation is unavailable");
	await ensureTeamConversationBinding(session, port);
	if (session.events.length === 0) return { session, migrated: false };

	const sourceFingerprint = legacyEventsFingerprint(session);
	const existingMarker = findMigrationMarker(port.readDocument(coordination.sessionId), session.id);
	if (existingMarker && existingMarker.sourceFingerprint !== sourceFingerprint) {
		throw new Error(`Legacy Team event migration fingerprint changed: ${session.id}`);
	}
	const plan = buildMigrationPlan(session);
	if (!existingMarker) {
		for (const message of plan.messages) await port.appendMessage(coordination.sessionId, message);
		for (const routing of plan.routings) {
			const existing = findRouting(port.readDocument(coordination.sessionId), routing.messageEntryId);
			if (existing) {
				if (!sameRouting(existing, routing)) {
					throw new Error(`Legacy Team routing conflicts with existing metadata: ${routing.messageEntryId}`);
				}
				continue;
			}
			await port.appendMetadata(coordination.sessionId, routing.customType, routing);
		}
		for (const workItem of plan.workItems) {
			const existing = findWorkItem(port.readDocument(coordination.sessionId), workItem.id);
			if (existing) {
				if (!sameWorkItemIdentity(existing, workItem) || existing.resultMessageId !== workItem.resultMessageId) {
					throw new Error(`Legacy Team work item conflicts with existing metadata: ${workItem.id}`);
				}
				continue;
			}
			await port.appendMetadata(coordination.sessionId, "agent-team.work-item.v1", workItem);
		}
	}

	validateMigrationProjection(session, port.readDocument(coordination.sessionId), plan);
	const marker =
		existingMarker ??
		({
			customType: "agent-team.legacy-events-migration.v1",
			teamSessionId: session.id,
			coordinationConversationId: coordination.sessionId,
			sourceFingerprint,
			migratedEventIds: session.events.map((event) => event.id),
			resultSources: session.events.flatMap((event) =>
				event.type === "member-result" ? [{ messageEntryId: event.id, sourceTurnId: event.sourceTurnId }] : [],
			),
			completedAt: now(),
		} satisfies TeamLegacyEventsMigrationRecord);
	if (!existingMarker) await port.appendMetadata(coordination.sessionId, marker.customType, marker);
	const persistedMarker = findMigrationMarker(port.readDocument(coordination.sessionId), session.id);
	if (!persistedMarker || persistedMarker.sourceFingerprint !== sourceFingerprint) {
		throw new Error(`Legacy Team event migration marker was not persisted: ${session.id}`);
	}
	return {
		session: {
			...session,
			revision: session.revision + 1,
			updatedAt: now(),
			events: [],
		},
		migrated: true,
	};
}

function buildMigrationPlan(session: TeamSessionDocument): {
	readonly messages: readonly ConversationMessageRecord[];
	readonly routings: readonly TeamMessageRoutingRecord[];
	readonly workItems: readonly TeamWorkItem[];
} {
	const messages = session.events.flatMap((event): ConversationMessageRecord[] => {
		if (event.type === "member-delegation") return [];
		if (event.type === "user-message") {
			return [
				{
					kind: "user",
					id: event.id,
					turnId: event.requestId,
					timestamp: event.timestamp,
					author: { kind: "user", id: "local-user" },
					message: { role: "user", content: event.text, timestamp: event.timestamp },
					...(event.attachments?.length ? { attachments: [...event.attachments] } : {}),
				},
			];
		}
		return [
			{
				kind: "agent",
				id: event.id,
				turnId: event.requestId,
				timestamp: event.timestamp,
				author: {
					kind: "agent",
					id: event.memberId,
					...(session.memberRuntime[event.memberId]?.agentProfileId
						? { agentId: session.memberRuntime[event.memberId]?.agentProfileId }
						: {}),
				},
				message: {
					...createAssistantMessage(
						{ api: "agent-team-legacy", provider: "agent-team-legacy", model: "legacy-result" },
						{ timestamp: event.timestamp },
					),
					content: [{ type: "text", text: event.text }],
				},
			},
		];
	});
	const routings = session.events.flatMap((event): TeamMessageRoutingRecord[] =>
		event.type === "user-message"
			? [
					{
						customType: "agent-team.message-routing.v1",
						messageEntryId: event.id,
						addressedParticipantIds: [...event.targetMemberIds],
						requestId: event.requestId,
					},
				]
			: [],
	);
	return { messages, routings, workItems: legacyWorkItems(session) };
}

function legacyWorkItems(session: TeamSessionDocument): readonly TeamWorkItem[] {
	const byId = new Map<string, TeamWorkItem>();
	const userByRequest = new Map(
		session.events.flatMap((event) => (event.type === "user-message" ? [[event.requestId, event] as const] : [])),
	);
	for (const event of session.events) {
		if (event.type === "user-message") {
			const targets = event.targetMemberIds.length > 0 ? event.targetMemberIds : [session.leaderMemberId];
			for (const memberId of targets) {
				const id = `work:${event.requestId}:${memberId}`;
				byId.set(id, {
					id,
					requestTurnId: event.requestId,
					createdByParticipantId: "local-user",
					assignedToParticipantId: memberId,
					objective: event.text,
					contextEntryIds: [event.id],
					...(event.attachments?.length ? { artifactRefs: [...event.attachments] } : {}),
					state: "waiting",
					createdAt: event.timestamp,
					updatedAt: event.timestamp,
					revision: 0,
				});
			}
		}
		if (event.type === "member-delegation") {
			const id = `work:${event.requestId}:${event.targetMemberId}`;
			const source = userByRequest.get(event.requestId);
			byId.set(id, {
				id,
				requestTurnId: event.requestId,
				createdByParticipantId: event.sourceMemberId,
				assignedToParticipantId: event.targetMemberId,
				objective: event.objective,
				contextEntryIds: source ? [source.id] : [],
				state: "waiting",
				createdAt: event.timestamp,
				updatedAt: event.timestamp,
				revision: 0,
			});
		}
		if (event.type === "member-result") {
			const id = `work:${event.requestId}:${event.memberId}`;
			const existing = byId.get(id);
			const source = userByRequest.get(event.requestId);
			byId.set(id, {
				...(existing ?? {
					id,
					requestTurnId: event.requestId,
					createdByParticipantId: "local-user",
					assignedToParticipantId: event.memberId,
					objective: source?.text ?? `Recover legacy Team request ${event.requestId}`,
					contextEntryIds: source ? [source.id] : [],
					createdAt: source?.timestamp ?? event.timestamp,
				}),
				state: "completed",
				resultMessageId: event.id,
				updatedAt: event.timestamp,
				revision: existing ? existing.revision + 1 : 0,
			});
		}
	}
	return [...byId.values()];
}

function validateMigrationProjection(
	session: TeamSessionDocument,
	document: ConversationDocument,
	plan: ReturnType<typeof buildMigrationPlan>,
): void {
	const actualMessages = document.entries.filter(
		(entry) => entry.type === "message" && plan.messages.some((message) => message.id === entry.id),
	);
	if (actualMessages.length !== plan.messages.length) {
		throw new Error(`Legacy Team message migration count mismatch: ${session.id}`);
	}
	if (!plan.messages.every((message, index) => actualMessages[index]?.id === message.id)) {
		throw new Error(`Legacy Team message migration order mismatch: ${session.id}`);
	}
	for (const routing of plan.routings) {
		const actual = findRouting(document, routing.messageEntryId);
		if (!actual || !sameRouting(actual, routing)) {
			throw new Error(`Legacy Team routing migration mismatch: ${routing.messageEntryId}`);
		}
	}
	for (const workItem of plan.workItems) {
		const actual = findWorkItem(document, workItem.id);
		if (!actual || !sameWorkItemIdentity(actual, workItem) || actual.resultMessageId !== workItem.resultMessageId) {
			throw new Error(`Legacy Team work item migration mismatch: ${workItem.id}`);
		}
	}
}

function legacyEventsFingerprint(session: TeamSessionDocument): string {
	return stableTeamEventId(["legacy-events-migration", session.id, ...session.events.map(canonicalLegacyEvent)]);
}

function canonicalLegacyEvent(event: LegacyTeamFeedEvent): string {
	return JSON.stringify(event);
}

function latestCustomRecord(document: ConversationDocument, customType: string): unknown {
	const entry = findLastEntry(
		document,
		(candidate) => candidate.type === "custom" && candidate.customType === customType,
	);
	return entry?.type === "custom" ? entry.data : undefined;
}

function findMigrationMarker(
	document: ConversationDocument,
	teamSessionId: string,
): TeamLegacyEventsMigrationRecord | undefined {
	const entry = findLastEntry(
		document,
		(entry) =>
			entry.type === "custom" &&
			entry.customType === "agent-team.legacy-events-migration.v1" &&
			isTeamLegacyEventsMigrationRecord(entry.data) &&
			entry.data.teamSessionId === teamSessionId,
	);
	return entry?.type === "custom" && isTeamLegacyEventsMigrationRecord(entry.data) ? entry.data : undefined;
}

function findRouting(document: ConversationDocument, messageEntryId: string): TeamMessageRoutingRecord | undefined {
	const entry = findLastEntry(
		document,
		(entry) =>
			entry.type === "custom" &&
			entry.customType === "agent-team.message-routing.v1" &&
			isRouting(entry.data) &&
			entry.data.messageEntryId === messageEntryId,
	);
	const data = entry?.type === "custom" ? entry.data : undefined;
	return isRouting(data) ? data : undefined;
}

function findWorkItem(document: ConversationDocument, id: string): TeamWorkItem | undefined {
	const entry = findLastEntry(
		document,
		(entry) =>
			entry.type === "custom" &&
			entry.customType === "agent-team.work-item.v1" &&
			isTeamWorkItem(entry.data) &&
			entry.data.id === id,
	);
	const data = entry?.type === "custom" ? entry.data : undefined;
	return isTeamWorkItem(data) ? data : undefined;
}

function sameBinding(value: unknown, expected: TeamConversationBindingRecord): boolean {
	if (!isRecord(value) || value.customType !== expected.customType) return false;
	return JSON.stringify(value) === JSON.stringify(expected);
}

function isRouting(value: unknown): value is TeamMessageRoutingRecord {
	return (
		isRecord(value) &&
		value.customType === "agent-team.message-routing.v1" &&
		typeof value.messageEntryId === "string"
	);
}

function sameRouting(left: TeamMessageRoutingRecord, right: TeamMessageRoutingRecord): boolean {
	return (
		left.messageEntryId === right.messageEntryId &&
		left.requestId === right.requestId &&
		left.intent === right.intent &&
		sameIds(left.addressedParticipantIds ?? [], right.addressedParticipantIds ?? [])
	);
}

function sameWorkItemIdentity(left: TeamWorkItem, right: TeamWorkItem): boolean {
	return (
		left.requestTurnId === right.requestTurnId &&
		left.createdByParticipantId === right.createdByParticipantId &&
		left.assignedToParticipantId === right.assignedToParticipantId &&
		left.objective === right.objective
	);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
	const leftSorted = [...left].sort();
	const rightSorted = [...right].sort();
	return leftSorted.length === rightSorted.length && leftSorted.every((id, index) => id === rightSorted[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findLastEntry(
	document: ConversationDocument,
	predicate: (entry: ConversationDocument["entries"][number]) => boolean,
): ConversationDocument["entries"][number] | undefined {
	for (let index = document.entries.length - 1; index >= 0; index -= 1) {
		const entry = document.entries[index];
		if (entry && predicate(entry)) return entry;
	}
	return undefined;
}
