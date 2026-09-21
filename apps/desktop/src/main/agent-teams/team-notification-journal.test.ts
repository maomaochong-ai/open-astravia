import type { TeamSessionDocument } from "@vetta/agent-team";
import { type ConversationDocument, createEmptyConversationDocument } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { TeamCollaborationStore } from "./team-collaboration-store.js";
import { TeamNotificationJournal, undeliveredTeamNotifications } from "./team-notification-journal.js";

function fixture() {
	let document = createEmptyConversationDocument({ sessionId: "coordination", createdAt: 1 });
	const port = {
		readSessionDocument: () => document,
		appendSessionMetadataEntry: async (_id: string, customType: string, data?: unknown) => {
			const entry = {
				type: "custom" as const,
				id: `entry-${document.entries.length}`,
				parentId: document.activeLeafId,
				timestamp: "1",
				customType,
				data,
			};
			document = { ...document, entries: [...document.entries, entry], activeLeafId: entry.id };
		},
	};
	const store = new TeamCollaborationStore(port);
	const runtime = {
		sessionId: "member-runtime",
		sessionPath: "/fixture/member",
		agentProfileRevision: 1,
		deliveredEventIds: [],
	};
	const session: TeamSessionDocument = {
		schemaVersion: 1,
		revision: 0,
		id: "team-session",
		teamId: "team",
		name: "Team",
		cwd: "/fixture",
		leaderMemberId: "leader",
		memberHandles: { leader: "leader", member: "member" },
		createdAt: 1,
		updatedAt: 1,
		coordinationRuntime: { sessionId: "coordination", sessionPath: "/fixture/coordination" },
		events: [],
		memberRuntime: { member: runtime, leader: { ...runtime, sessionId: "leader-runtime" } },
	};
	const input = {
		session,
		memberId: "member",
		requestId: "task",
		createdByParticipantId: "leader",
		objective: "Review",
	};
	return {
		store,
		session,
		input,
		journal: new TeamNotificationJournal(store),
		restart: () => new TeamNotificationJournal(new TeamCollaborationStore(port)),
	};
}

describe("durable Team task notification handoff", () => {
	it("rediscovers an unrecorded terminal outcome and admits its context exactly once across restart", async () => {
		const { store, session, input, restart } = fixture();
		const attempt = await store.begin({ ...input, sourceTurnId: "first", mode: "initial" });
		const completed = await store.settle(
			session,
			attempt.workItem,
			attempt.attempt,
			{ state: "completed" },
			"published-result",
		);
		const restored = restart();
		await restored.record(session, completed);
		await restored.record(session, completed);
		const pending = restored.pending(session, "leader");
		expect(pending).toHaveLength(1);
		const ids = pending.map((entry) => entry.id);
		await store.enqueue({
			session,
			memberId: "leader",
			requestId: "follow-up",
			createdByParticipantId: "local-user",
			objective: "Integrate result",
			notificationIds: ids,
		});
		const admitted = restart();
		expect(admitted.pending(session)).toHaveLength(0);
		const context = admitted.contexts(session, ids);
		expect(context).toMatchObject([
			{
				type: "agent-team.task-completed.v1",
				metadata: { notificationId: ids[0], resultMessageId: "published-result" },
			},
		]);
		const memberDocument: ConversationDocument = {
			...createEmptyConversationDocument({ sessionId: "leader-runtime", createdAt: 1 }),
			entries: [
				{
					type: "custom_message",
					id: "delivered",
					parentId: null,
					timestamp: "1",
					customType: context[0]!.type,
					content: context[0]!.content,
					details: context[0]!.metadata,
					display: false,
				},
			],
		};
		expect(undeliveredTeamNotifications(context, memberDocument)).toHaveLength(0);
	});

	it("keeps blocked outcomes actionable and never turns a legacy completed task into a new wake", async () => {
		const { store, session, input, journal } = fixture();
		const attempt = await store.begin({ ...input, sourceTurnId: "first", mode: "initial" });
		const blocked = await store.settle(session, attempt.workItem, attempt.attempt, {
			state: "awaiting-resource",
			issue: { category: "authentication", retryability: "after-external-change", code: "AI_AUTHENTICATION_FAILED" },
		});
		await journal.record(session, blocked);
		const pending = journal.pending(session);
		expect(
			journal.contexts(
				session,
				pending.map((entry) => entry.id),
			),
		).toMatchObject([
			{
				type: "agent-team.task-status.v1",
				metadata: { state: "attention-required", issue: { category: "authentication" } },
			},
		]);
		await journal.record(session, {
			...blocked,
			id: "legacy",
			recovery: undefined,
			state: "completed",
			resultMessageId: "old-result",
		});
		expect(journal.pending(session)).toHaveLength(1);
	});

	it("persists stop across restart and discards previous notices when the user starts new work", async () => {
		const { store, session, input, journal, restart } = fixture();
		const attempt = await store.begin({ ...input, sourceTurnId: "first", mode: "initial" });
		const completed = await store.settle(
			session,
			attempt.workItem,
			attempt.attempt,
			{ state: "completed" },
			"result",
		);
		await journal.stop(session);
		const restored = restart();
		expect(restored.isStopped(session)).toBe(true);
		await restored.record(session, completed);
		expect(restored.pending(session)).toHaveLength(0);
		await restored.resume(session);
		await restored.record(session, completed);
		expect(restored.isStopped(session)).toBe(false);
		expect(restored.pending(session)).toHaveLength(0);
	});
});
