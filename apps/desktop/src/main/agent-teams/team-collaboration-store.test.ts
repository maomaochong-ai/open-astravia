import {
	classifyTeamAttemptTerminal,
	createTeamSharedContextCheckpoint,
	createTeamSharedContextGeneration,
	type TeamSessionDocument,
} from "@vetta/agent-team";
import { type ConversationDocument, createEmptyConversationDocument } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { TeamCollaborationStore } from "./team-collaboration-store.js";

describe("TeamCollaborationStore", () => {
	it("stores one independently evolving delivery per recipient", async () => {
		const store = createStore();
		const deliveries = await store.createDeliveries(
			session(),
			["one", "two"].map((toParticipantId) => ({
				id: `delivery-${toParticipantId}`,
				messageId: "message",
				fromParticipantId: "leader",
				toParticipantId,
				intent: "question" as const,
				state: "pending" as const,
				createdAt: 1,
				updatedAt: 1,
			})),
		);
		expect(deliveries).toHaveLength(2);
		await store.updateDelivery(session(), "delivery-one", { state: "waiting" });
		await store.updateDelivery(session(), "delivery-one", { state: "responded", replyMessageId: "reply" });
		await store.updateDelivery(session(), "delivery-two", { state: "failed" });
		expect(store.read(session()).deliveries).toMatchObject([
			{ id: "delivery-one", state: "responded", replyMessageId: "reply" },
			{ id: "delivery-two", state: "failed" },
		]);
	});

	it("persists one shared checkpoint and generation under concurrent admission", async () => {
		const store = createStore();
		const checkpoint = createTeamSharedContextCheckpoint({
			coordinationConversationId: "coordination",
			throughConversationRevision: 3,
			policyVersion: "public-results-v1",
			records: [],
			memberHandles: {},
		});
		const generation = createTeamSharedContextGeneration({ teamRevision: 1, checkpoint });
		const results = await Promise.all([
			store.ensureSharedContext(session(), checkpoint, generation),
			store.ensureSharedContext(session(), checkpoint, generation),
		]);
		expect(results[0]).toEqual(results[1]);
		expect(store.read(session())).toMatchObject({
			checkpoints: [{ id: checkpoint.id }],
			contextGenerations: [{ id: generation.id, checkpointId: checkpoint.id }],
		});
	});
	it("persists queued work before starting an attempt and rejects changed attachments", async () => {
		const store = createStore();
		await store.enqueue({ ...workInput(), attachments: [{ kind: "file", path: "C:/one.md" }] });
		expect(store.read(session())).toMatchObject({ workItems: [{ state: "queued" }], attempts: [] });
		await expect(
			store.enqueue({ ...workInput(), attachments: [{ kind: "file", path: "C:/two.md" }] }),
		).rejects.toThrow("different content");
		await store.releaseQueued(session(), "work:request:member", "cancelled");
		expect(store.read(session()).workItems[0]?.state).toBe("cancelled");
	});

	it("admits only one of two concurrent attempts", async () => {
		const store = createStore();
		const input = { ...workInput(), sourceTurnId: "turn", mode: "initial" as const };
		const results = await Promise.allSettled([store.begin(input), store.begin(input)]);
		expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
		expect(store.read(session()).attempts).toHaveLength(1);
		await store.releaseQueued(session(), "work:request:member", "cancelled");
		expect(store.read(session()).workItems[0]?.state).toBe("running");
	});

	it("does not allow a late old attempt to overwrite a recovered attempt", async () => {
		const store = createStore();
		const first = await store.begin({ ...workInput(), sourceTurnId: "turn", mode: "initial" });
		const interrupted = classifyTeamAttemptTerminal({ hasPublishableMessage: false, cancelled: false });
		const waiting = await store.settle(session(), first.workItem, first.attempt, interrupted);
		await expect(store.settle(session(), first.workItem, first.attempt, interrupted)).resolves.toEqual(waiting);
		const second = await store.begin({ ...workInput(), sourceTurnId: "retry", mode: "retry" });
		await expect(store.settle(session(), first.workItem, first.attempt, interrupted)).rejects.toThrow(
			"no longer owns",
		);
		expect(store.read(session()).workItems[0]).toEqual(second.workItem);
		expect(store.read(session()).attempts.find((attempt) => attempt.id === second.attempt.id)?.state).toBe("running");
	});

	it("converts an orphaned running attempt into an immediately recoverable wait exactly once", async () => {
		const store = createStore();
		const running = await store.begin({ ...workInput(), sourceTurnId: "turn", mode: "initial" });
		const recovered = await store.recoverOrphanedAttempt(session(), running.workItem.id);
		expect(recovered).toMatchObject({
			state: "waiting",
			lastIssue: { category: "host-interrupted", retryability: "automatic" },
		});
		const state = store.read(session());
		expect(state.attempts).toHaveLength(1);
		expect(state.attempts[0]).toMatchObject({
			state: "waiting-retry",
			issue: { category: "host-interrupted" },
			nextRetryAt: expect.any(Number),
		});
		await expect(store.recoverOrphanedAttempt(session(), running.workItem.id)).resolves.toEqual(recovered);
		expect(store.read(session()).attempts).toHaveLength(1);
	});

	it("completes a waiting attempt from an already durable public result", async () => {
		const store = createStore();
		const running = await store.begin({ ...workInput(), sourceTurnId: "turn", mode: "initial" });
		await store.settle(
			session(),
			running.workItem,
			running.attempt,
			classifyTeamAttemptTerminal({ hasPublishableMessage: false, cancelled: false }),
		);
		const completed = await store.completePublished(
			session(),
			running.workItem.id,
			running.attempt.id,
			"public-result",
		);
		expect(completed).toMatchObject({ state: "completed", resultMessageId: "public-result" });
		expect(store.read(session()).attempts[0]?.state).toBe("completed");
		await expect(
			store.completePublished(session(), running.workItem.id, running.attempt.id, "public-result"),
		).resolves.toEqual(completed);
	});

	it("persists recoverable work-item attempts in the ordinary coordination conversation", async () => {
		let document: ConversationDocument = createEmptyConversationDocument({
			sessionId: "coordination",
			createdAt: 1,
		});
		let sequence = 0;
		const store = new TeamCollaborationStore({
			readSessionDocument: () => document,
			appendSessionMetadataEntry: async (_sessionId, customType, data) => {
				const id = `custom-${++sequence}`;
				document = {
					...document,
					journalVersion: document.journalVersion + 1,
					entries: [
						...document.entries,
						{
							type: "custom",
							id,
							parentId: document.activeLeafId,
							timestamp: new Date(sequence).toISOString(),
							customType,
							data,
						},
					],
					activeLeafId: id,
				};
			},
		});

		const first = await store.begin({
			session: session(),
			memberId: "member",
			requestId: "request",
			sourceTurnId: "turn",
			createdByParticipantId: "leader",
			objective: "Investigate",
			mode: "initial",
		});
		expect(first).toMatchObject({
			created: true,
			workItem: { state: "running", currentAttemptId: "attempt:work:request:member:1" },
			attempt: { attempt: 1, state: "running" },
		});

		const waiting = await store.settle(
			session(),
			first.workItem,
			first.attempt,
			classifyTeamAttemptTerminal({ hasPublishableMessage: false, cancelled: false }),
		);
		expect(waiting.state).toBe("waiting");

		const retry = await store.begin({
			session: session(),
			memberId: "member",
			requestId: "request",
			sourceTurnId: "turn-retry",
			createdByParticipantId: "leader",
			objective: "Investigate",
			mode: "retry",
		});
		expect(retry).toMatchObject({
			created: false,
			workItem: { state: "running", currentAttemptId: "attempt:work:request:member:2" },
			attempt: { attempt: 2, mode: "retry", state: "running" },
		});
		expect(store.read(session()).attempts).toHaveLength(2);
	});
});

function workInput() {
	return {
		session: session(),
		memberId: "member",
		requestId: "request",
		createdByParticipantId: "leader",
		objective: "Investigate",
	};
}

function createStore(): TeamCollaborationStore {
	let document = createEmptyConversationDocument({ sessionId: "coordination", createdAt: 1 });
	return new TeamCollaborationStore({
		readSessionDocument: () => document,
		appendSessionMetadataEntry: async (_sessionId, customType, data) => {
			await Promise.resolve();
			const id = `entry-${document.entries.length}`;
			document = {
				...document,
				entries: [
					...document.entries,
					{
						id,
						type: "custom",
						customType,
						data,
						parentId: document.activeLeafId,
						timestamp: new Date(1).toISOString(),
					},
				],
				activeLeafId: id,
			};
		},
	});
}

function session(): TeamSessionDocument {
	return {
		schemaVersion: 1,
		revision: 0,
		id: "team-session",
		teamId: "team",
		name: "Team",
		cwd: "C:/workspace",
		leaderMemberId: "leader",
		memberHandles: { leader: "leader", member: "member" },
		createdAt: 1,
		updatedAt: 1,
		coordinationRuntime: { sessionId: "coordination", sessionPath: "C:/runtime/coordination.jsonl" },
		events: [],
		memberRuntime: {
			member: {
				sessionId: "member-conversation",
				sessionPath: "C:/runtime/member.jsonl",
				agentProfileRevision: 1,
				deliveredEventIds: [],
			},
		},
	};
}
