import type { TeamSessionDocument, TeamSessionStreamEvent } from "@vetta/agent-team";
import { describe, expect, it } from "vitest";
import {
	buildTeamNavigationTurns,
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
	kind: "agent",
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

	it("renders an attachments-only structured message without exposing its full path", () => {
		const items = buildTeamTimelineItems({
			session: {
				...session,
				events: [
					{
						type: "user-message",
						id: "attachment-message",
						requestId: "attachment-request",
						text: "",
						targetMemberIds: [],
						attachments: [{ kind: "file", path: "C:/workspace/notes.txt" }],
						timestamp: 1,
					},
				],
			},
			pending: undefined,
			streams: {},
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});
		expect(items).toEqual([
			expect.objectContaining({
				kind: "message",
				message: expect.objectContaining({
					kind: "user",
					text: "",
					deliveryPhase: "completed",
					attachments: [{ kind: "file", path: "C:/workspace/notes.txt" }],
				}),
			}),
		]);
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
		expect(items.filter((item) => item.kind === "message" && item.message.kind === "user")).toHaveLength(1);
		expect(items.at(-1)).toMatchObject({
			kind: "message",
			message: { kind: "agent", phase: "streaming", blocks: [{ text: "partial" }] },
		});
	});

	it("groups every member response and delegation for one request into a reusable navigation turn", () => {
		const items = buildTeamTimelineItems({
			session: {
				...session,
				memberHandles: { leader: "vetta", reviewer: "reviewer" },
				events: [
					{
						type: "user-message",
						id: "user-event",
						requestId: "request",
						text: "Review the launch plan",
						targetMemberIds: ["leader"],
						timestamp: 1,
					},
					{
						type: "member-delegation",
						id: "delegation-event",
						requestId: "request",
						sourceMemberId: "leader",
						targetMemberId: "reviewer",
						objective: "Review risks",
						timestamp: 2,
					},
					{
						type: "member-result",
						id: "member-event",
						requestId: "request",
						memberId: "reviewer",
						sourceTurnId: "review-turn",
						text: "Launch risks found",
						timestamp: 3,
					},
				],
			},
			pending: undefined,
			streams: {},
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		const turns = buildTeamNavigationTurns(items);
		expect(turns).toHaveLength(1);
		expect(turns[0].entries.map((entry) => [entry.role, entry.preview, entry.itemIndex])).toEqual([
			["request", "Review the launch plan", 0],
			["response", "Vetta -> reviewer", 1],
			["response", "Launch risks found", 2],
		]);
	});
});
