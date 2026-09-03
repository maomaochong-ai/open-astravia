import { describe, expect, it } from "vitest";
import { markTeamMemberContextDelivered } from "../src/context-projector.js";
import {
	createLegacyTeamMemberDelegationEvent,
	createLegacyTeamMemberResultEvent,
	createLegacyTeamUserMessageEvent,
} from "../src/legacy-events.js";

describe("Team context cursor and legacy identities", () => {
	it("keeps schema-v1 migration identities deterministic", () => {
		const first = createLegacyTeamUserMessageEvent({
			teamSessionId: "session",
			requestId: "request",
			text: "first",
			targetMemberIds: ["leader"],
			timestamp: 1,
		});
		const replay = createLegacyTeamUserMessageEvent({
			teamSessionId: "session",
			requestId: "request",
			text: "changed migration payload",
			targetMemberIds: [],
			timestamp: 99,
		});
		expect(replay.id).toBe(first.id);
	});

	it("updates a member cursor without appending a legacy event", () => {
		const delegation = createLegacyTeamMemberDelegationEvent({
			teamSessionId: "session",
			requestId: "delegation",
			sourceMemberId: "leader",
			targetMemberId: "builder",
			objective: "Build it",
			timestamp: 2,
		});
		const result = createLegacyTeamMemberResultEvent({
			teamSessionId: "session",
			requestId: "delegation",
			memberId: "builder",
			sourceTurnId: "builder-turn",
			text: "Built",
			timestamp: 3,
		});
		const session = {
			schemaVersion: 1 as const,
			revision: 3,
			id: "session",
			teamId: "team",
			name: "Team",
			cwd: "C:/workspace",
			leaderMemberId: "leader",
			memberHandles: { leader: "leader", builder: "builder" },
			createdAt: 1,
			updatedAt: 3,
			events: [delegation, result],
			memberRuntime: {
				leader: {
					sessionId: "leader-runtime",
					sessionPath: "C:/leader.jsonl",
					agentProfileRevision: 1,
					deliveredEventIds: [],
				},
				builder: {
					sessionId: "builder-runtime",
					sessionPath: "C:/builder.jsonl",
					agentProfileRevision: 1,
					deliveredEventIds: [delegation.id],
				},
			},
		};

		const completed = markTeamMemberContextDelivered({
			session,
			memberId: "leader",
			deliveredEventIds: [result.id, result.id],
			timestamp: 4,
		});

		expect(completed.events).toEqual(session.events);
		expect(completed.memberRuntime.leader?.deliveredEventIds).toEqual([result.id]);
		expect(completed.revision).toBe(4);
	});
});
