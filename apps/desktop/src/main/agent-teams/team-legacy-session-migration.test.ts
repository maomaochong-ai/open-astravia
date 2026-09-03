import {
	createLegacyTeamMemberDelegationEvent,
	createLegacyTeamMemberResultEvent,
	createLegacyTeamUserMessageEvent,
	isTeamLegacyEventsMigrationRecord,
	isTeamWorkItem,
	type TeamSessionDocument,
} from "@vetta/agent-team";
import {
	applyConversationDocumentCommand,
	type ConversationDocument,
	createEmptyConversationDocument,
} from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import {
	ensureTeamConversationBinding,
	migrateLegacyTeamSessionEvents,
	type TeamLegacySessionMigrationPort,
} from "./team-legacy-session-migration.js";

function fixture() {
	let document: ConversationDocument = createEmptyConversationDocument({
		sessionId: "coordination",
		createdAt: 1,
		cwd: "C:/workspace",
	});
	let metadataSequence = 0;
	const port: TeamLegacySessionMigrationPort = {
		readDocument: () => document,
		appendMessage: async (_sessionId, message) => {
			document = applyConversationDocumentCommand(document, { type: "message.append", record: message }).document;
			return { entryId: message.id };
		},
		appendMetadata: async (_sessionId, customType, data) => {
			document = applyConversationDocumentCommand(document, {
				type: "custom.append",
				entryId: `metadata-${++metadataSequence}`,
				customType,
				data,
				timestamp: new Date(metadataSequence).toISOString(),
			}).document;
		},
	};
	const user = createLegacyTeamUserMessageEvent({
		teamSessionId: "session",
		requestId: "request",
		text: "Review the release",
		targetMemberIds: ["leader"],
		attachments: [{ kind: "file", path: "C:/workspace/release.md" }],
		timestamp: 10,
	});
	const delegation = createLegacyTeamMemberDelegationEvent({
		teamSessionId: "session",
		requestId: "delegated-request",
		sourceMemberId: "leader",
		targetMemberId: "reviewer",
		objective: "Check release risks",
		timestamp: 20,
	});
	const result = createLegacyTeamMemberResultEvent({
		teamSessionId: "session",
		requestId: "delegated-request",
		memberId: "reviewer",
		sourceTurnId: "reviewer-turn",
		text: "One release risk remains",
		timestamp: 30,
	});
	const session: TeamSessionDocument = {
		schemaVersion: 1,
		revision: 4,
		id: "session",
		teamId: "team",
		teamRevision: 2,
		name: "Team",
		cwd: "C:/workspace",
		leaderMemberId: "leader",
		activeMemberIds: ["leader", "reviewer"],
		memberHandles: { leader: "leader", reviewer: "reviewer" },
		createdAt: 1,
		updatedAt: 30,
		coordinationRuntime: { sessionId: "coordination", sessionPath: "C:/sessions/coordination.jsonl" },
		events: [user, delegation, result],
		memberRuntime: {
			leader: {
				sessionId: "leader-conversation",
				sessionPath: "C:/sessions/leader.jsonl",
				agentProfileRevision: 1,
				deliveredEventIds: [],
			},
			reviewer: {
				sessionId: "reviewer-conversation",
				sessionPath: "C:/sessions/reviewer.jsonl",
				agentProfileRevision: 1,
				deliveredEventIds: [user.id],
			},
		},
	};
	return { port, session, readDocument: () => document, events: { user, delegation, result } };
}

describe("legacy Team session migration", () => {
	it("imports legacy messages and collaboration state before clearing the compatibility events", async () => {
		const f = fixture();
		const migrated = await migrateLegacyTeamSessionEvents(f.session, f.port, () => 40);

		expect(migrated.migrated).toBe(true);
		expect(migrated.session.events).toEqual([]);
		const entries = f.readDocument().entries;
		const messages = entries.filter((entry) => entry.type === "message");
		expect(messages.map((entry) => entry.id)).toEqual([f.events.user.id, f.events.result.id]);
		expect(messages[0]).toMatchObject({
			kind: "user",
			author: { kind: "user", id: "local-user" },
			attachments: [{ kind: "file", path: "C:/workspace/release.md" }],
		});
		expect(messages[1]).toMatchObject({
			kind: "agent",
			author: { kind: "agent", id: "reviewer" },
			message: { content: [{ type: "text", text: "One release risk remains" }] },
		});
		const workItems = entries.flatMap((entry) =>
			entry.type === "custom" && entry.customType === "agent-team.work-item.v1" && isTeamWorkItem(entry.data)
				? [entry.data]
				: [],
		);
		expect(workItems).toEqual([
			expect.objectContaining({ assignedToParticipantId: "leader", state: "waiting" }),
			expect.objectContaining({
				createdByParticipantId: "leader",
				assignedToParticipantId: "reviewer",
				state: "completed",
				resultMessageId: f.events.result.id,
			}),
		]);
		const marker = entries.find(
			(entry) =>
				entry.type === "custom" &&
				entry.customType === "agent-team.legacy-events-migration.v1" &&
				isTeamLegacyEventsMigrationRecord(entry.data),
		);
		expect(marker?.type === "custom" ? marker.data : undefined).toMatchObject({
			migratedEventIds: [f.events.user.id, f.events.delegation.id, f.events.result.id],
			resultSources: [{ messageEntryId: f.events.result.id, sourceTurnId: "reviewer-turn" }],
		});
	});

	it("re-enters after the marker without duplicating messages or metadata", async () => {
		const f = fixture();
		await migrateLegacyTeamSessionEvents(f.session, f.port, () => 40);
		const count = f.readDocument().entries.length;

		const replayed = await migrateLegacyTeamSessionEvents(f.session, f.port, () => 50);
		expect(replayed.session.events).toEqual([]);
		expect(f.readDocument().entries).toHaveLength(count);
		await ensureTeamConversationBinding(replayed.session, f.port);
		expect(f.readDocument().entries).toHaveLength(count);
	});
});
