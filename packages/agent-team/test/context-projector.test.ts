import { describe, expect, it } from "vitest";
import {
	createMemberDelegationEvent,
	createMemberResultEvent,
	createUserMessageEvent,
	finalizeTeamMemberTurn,
	projectUndeliveredTeamContext,
} from "../src/context-projector.js";

describe("Team context projector", () => {
	it("is deterministic and excludes private/self events", () => {
		const user = createUserMessageEvent({
			teamSessionId: "session",
			requestId: "request",
			text: "hello",
			targetMemberIds: ["leader"],
			timestamp: 10,
		});
		const result = createMemberResultEvent({
			teamSessionId: "session",
			requestId: "old",
			memberId: "researcher",
			sourceTurnId: "turn",
			text: "answer",
			timestamp: 11,
		});
		const own = createMemberResultEvent({
			teamSessionId: "session",
			requestId: "old",
			memberId: "leader",
			sourceTurnId: "turn-2",
			text: "private-to-leader",
			timestamp: 12,
		});
		const session = { id: "session", events: [user, result, own] };
		const first = projectUndeliveredTeamContext(session, "leader", new Set(), "request");
		const second = projectUndeliveredTeamContext(session, "leader", new Set(), "request");
		expect(first).toEqual(second);
		expect(first.map((record) => record.text)).toEqual(["answer"]);
		expect(projectUndeliveredTeamContext(session, "leader", new Set([result.id]), "request")).toEqual([]);
	});

	it("deduplicates stable event identities", () => {
		const a = createUserMessageEvent({
			teamSessionId: "s",
			requestId: "r",
			text: "a",
			targetMemberIds: [],
			timestamp: 1,
		});
		const b = createUserMessageEvent({
			teamSessionId: "s",
			requestId: "r",
			text: "changed",
			targetMemberIds: [],
			timestamp: 99,
		});
		expect(a.id).toBe(b.id);
	});

	it("projects a delegation only to its target member", () => {
		const delegation = createMemberDelegationEvent({
			teamSessionId: "s",
			requestId: "delegate-request",
			sourceMemberId: "leader",
			targetMemberId: "builder",
			objective: "Implement the requested change",
			timestamp: 2,
		});
		const session = { id: "s", events: [delegation] };
		expect(projectUndeliveredTeamContext(session, "builder", new Set())).toMatchObject([
			{ type: "agent-team.member-delegation.v1", text: "Implement the requested change" },
		]);
		expect(projectUndeliveredTeamContext(session, "reviewer", new Set())).toEqual([]);
	});

	it("retains delegated work when the leader result merges into the latest session", () => {
		const delegation = createMemberDelegationEvent({
			teamSessionId: "s",
			requestId: "delegate",
			sourceMemberId: "leader",
			targetMemberId: "builder",
			objective: "Build it",
			timestamp: 2,
		});
		const delegatedResult = createMemberResultEvent({
			teamSessionId: "s",
			requestId: "delegate",
			memberId: "builder",
			sourceTurnId: "builder-turn",
			text: "Built",
			timestamp: 3,
		});
		const leaderResult = createMemberResultEvent({
			teamSessionId: "s",
			requestId: "request",
			memberId: "leader",
			sourceTurnId: "leader-turn",
			text: "Integrated",
			timestamp: 4,
		});
		const latest = {
			schemaVersion: 1 as const,
			revision: 3,
			id: "s",
			teamId: "team",
			name: "Team",
			cwd: "C:/workspace",
			leaderMemberId: "leader",
			memberHandles: { leader: "leader", builder: "builder" },
			createdAt: 1,
			updatedAt: 3,
			events: [delegation, delegatedResult],
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
		const completed = finalizeTeamMemberTurn({
			session: latest,
			memberId: "leader",
			result: leaderResult,
			deliveredEventIds: [delegatedResult.id],
			timestamp: 4,
		});
		expect(completed.events.map((event) => event.id)).toEqual([delegation.id, delegatedResult.id, leaderResult.id]);
	});
});
