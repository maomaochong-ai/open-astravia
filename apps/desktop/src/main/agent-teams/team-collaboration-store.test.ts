import type { TeamSessionDocument } from "@vetta/agent-team";
import { classifyTeamAttemptTerminal } from "@vetta/agent-team";
import { type ConversationDocument, createEmptyConversationDocument } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { TeamCollaborationStore } from "./team-collaboration-store.js";

describe("TeamCollaborationStore", () => {
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
