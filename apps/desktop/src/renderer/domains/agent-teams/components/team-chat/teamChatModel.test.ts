import type { TeamSessionDocument, TeamSessionStreamEvent } from "@vetta/agent-team";
import { describe, expect, it } from "vitest";
import {
	buildTeamTimelineItems,
	reduceTeamStreamState,
	stripAttachmentContext,
	type TeamMemberViewModel,
	updateScopedTeamDraft,
} from "./teamChatModel";

const session: TeamSessionDocument = {
	schemaVersion: 1,
	revision: 1,
	id: "session",
	teamId: "team",
	name: "Team",
	cwd: "C:/workspace",
	leaderMemberId: "leader",
	memberHandles: { leader: "vetta" },
	createdAt: 1,
	updatedAt: 1,
	events: [],
	memberRuntime: {},
};
const member: TeamMemberViewModel = {
	id: "leader",
	name: "Vetta",
	handle: "vetta",
	blueprintId: "leader",
	selected: false,
	status: "idle",
};

describe("team chat stream state", () => {
	it("keeps drafts isolated by team scope", () => {
		const first = updateScopedTeamDraft({}, "team-a", "draft a");
		const second = updateScopedTeamDraft(first, "team-b", "draft b");
		expect(second).toEqual({ "team-a": "draft a", "team-b": "draft b" });
	});

	it("keeps attachment routing context out of the visible timeline", () => {
		expect(stripAttachmentContext("Review this\n\n<attachments>\n- file: C:/notes.txt\n</attachments>")).toBe(
			"Review this",
		);
	});

	it("accumulates ordered deltas by turn and ignores replayed sequence numbers", () => {
		const start: TeamSessionStreamEvent = {
			type: "member-start",
			teamSessionId: "session",
			memberId: "leader",
			requestId: "request",
			turnId: "turn",
			seq: 0,
			timestamp: 1,
		};
		const first = reduceTeamStreamState({}, start);
		const next = reduceTeamStreamState(first, {
			type: "member-delta",
			teamSessionId: "session",
			memberId: "leader",
			requestId: "request",
			turnId: "turn",
			seq: 1,
			delta: "partial",
			timestamp: 2,
		});
		const replayed = reduceTeamStreamState(next, {
			type: "member-delta",
			teamSessionId: "session",
			memberId: "leader",
			requestId: "request",
			turnId: "turn",
			seq: 1,
			delta: " duplicate",
			timestamp: 3,
		});
		expect(replayed.turn?.text).toBe("partial");
	});

	it("restores in-flight text from a reconnect snapshot", () => {
		const state = reduceTeamStreamState(
			{},
			{
				type: "session-snapshot",
				teamSessionId: "session",
				session,
				activeTurns: [
					{
						turnId: "turn",
						memberId: "leader",
						requestId: "request",
						seq: 4,
						text: "restored partial",
						startedAt: 1,
					},
				],
			},
		);
		expect(state.turn?.text).toBe("restored partial");
	});

	it("removes an aborted turn so a cancelled request does not remain pending", () => {
		const state = reduceTeamStreamState(
			{
				turn: {
					turnId: "turn",
					requestId: "request",
					memberId: "leader",
					seq: 1,
					text: "partial",
					startedAt: 1,
					phase: "streaming",
				},
			},
			{
				type: "member-end",
				teamSessionId: "session",
				memberId: "leader",
				requestId: "request",
				turnId: "turn",
				seq: 2,
				phase: "aborted",
				timestamp: 2,
			},
		);
		expect(state.turn).toBeUndefined();
	});

	it("deduplicates optimistic user messages by request id and keeps partial member output visible", () => {
		const items = buildTeamTimelineItems({
			session: {
				...session,
				events: [
					{
						type: "user-message",
						id: "message",
						requestId: "request",
						text: "hello",
						targetMemberIds: [],
						timestamp: 1,
					},
				],
			},
			pending: { requestId: "request", text: "hello" },
			streams: {
				turn: {
					turnId: "turn",
					requestId: "request",
					memberId: "leader",
					seq: 1,
					text: "partial",
					startedAt: 2,
					phase: "streaming",
				},
			},
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});
		expect(items.filter((item) => item.kind === "user")).toHaveLength(1);
		expect(items.at(-1)).toMatchObject({ kind: "member", text: "partial", pending: true });
	});
});
