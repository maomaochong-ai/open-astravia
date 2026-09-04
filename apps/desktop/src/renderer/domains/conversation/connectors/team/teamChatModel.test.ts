import type {
	DesktopTeamSessionSnapshot,
	DesktopTeamSessionStreamEvent,
} from "@preload/api-types/team-conversation-display";
import type { TeamDefinition, TeamSessionDocument } from "@vetta/agent-team";
import { createAssistantMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import {
	projectTeamConversationTimeline,
	reduceTeamStreamState,
	resolveTeamMembers,
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

const team: TeamDefinition = {
	id: "team",
	revision: 1,
	name: "Team",
	description: "",
	leaderMemberId: "leader",
	members: [
		{
			id: "leader",
			handle: "vetta",
			binding: { kind: "reference", agentProfileId: "missing-profile" },
		},
	],
	orchestrationPolicyId: "default",
	contextPolicyId: "default",
	createdAt: 1,
	updatedAt: 1,
};

function snapshot(input: Partial<DesktopTeamSessionSnapshot> = {}): DesktopTeamSessionSnapshot {
	const messages = input.messages ?? [];
	const memberId = messages.find((record) => record.kind === "agent")?.author.id ?? "leader";
	return {
		session,
		conversationRevision: 0,
		messages: [],
		activities: [],
		...input,
		display:
			input.display ??
			(messages.some((record) => record.kind === "agent")
				? {
						memberConversations: [
							{
								memberId,
								runtimeSessionId: `${memberId}-runtime`,
								history: messages.map((record) => ({
									type: "message" as const,
									entryId: record.id,
									message: record.message,
								})),
							},
						],
					}
				: undefined),
	};
}

function userMessage(
	id: string,
	turnId: string,
	text: string,
	timestamp: number,
	attachments?: readonly { readonly kind: "file" | "image"; readonly path: string }[],
) {
	return {
		kind: "user" as const,
		id,
		turnId,
		author: { kind: "user" as const, id: "local-user" },
		message: { role: "user" as const, content: text, timestamp },
		timestamp,
		...(attachments?.length ? { attachments } : {}),
	};
}

function agentMessage(
	id: string,
	turnId: string,
	authorId: string,
	text: string,
	timestamp: number,
	toolCall?: { readonly id: string; readonly name: string; readonly arguments: Record<string, unknown> },
) {
	return {
		kind: "agent" as const,
		id,
		turnId,
		author: { kind: "agent" as const, id: authorId },
		message: {
			...createAssistantMessage(
				{ api: "agent-team-test", provider: "agent-team-test", model: "fixture" },
				{ timestamp },
			),
			content: [
				...(toolCall
					? [
							{
								type: "toolCall" as const,
								id: toolCall.id,
								name: toolCall.name,
								arguments: toolCall.arguments,
							},
						]
					: []),
				{ type: "text" as const, text },
			],
		},
		timestamp,
	};
}

function streamEvent(
	messageId: string,
	sequence: number,
	delta: string,
	authorId = "leader",
): Extract<DesktopTeamSessionStreamEvent, { type: "conversation.agent-message-event" }> {
	const partial = {
		...createAssistantMessage(
			{ api: "agent-team-test", provider: "agent-team-test", model: "fixture" },
			{ timestamp: sequence },
		),
		content: [{ type: "text" as const, text: delta }],
	};
	return {
		type: "conversation.agent-message-event",
		conversationId: "session",
		messageId,
		turnId: "request",
		author: { kind: "agent", id: authorId },
		sequence,
		timestamp: sequence,
		event: { type: "text_delta", contentIndex: 0, delta, partial },
	};
}

describe("resolveTeamMembers", () => {
	it("assigns a stable avatar when a legacy profile is missing", () => {
		const [resolved] = resolveTeamMembers(undefined, team, [], {}, (_profileId, fallbackHandle) => fallbackHandle);

		expect(resolved?.avatar).toMatch(/agent-team-avatars\/avatar-\d{2}\.webp$/u);
	});
});

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
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [
					userMessage("attachment-message", "attachment-request", "", 1, [
						{ kind: "file", path: "C:/workspace/notes.txt" },
					]),
				],
			}),
			pending: undefined,
			streams: {},
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});
		expect(items).toEqual([
			expect.objectContaining({
				kind: "user",
				text: "",
				deliveryPhase: "completed",
				attachments: [{ kind: "file", path: "C:/workspace/notes.txt" }],
			}),
		]);
	});

	it("keeps the Team shell while filtering the feed to one member conversation", () => {
		const reviewer: TeamMemberViewModel = {
			...member,
			id: "reviewer",
			name: "Review",
			handle: "review",
			blueprintId: "reviewer",
		};
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				display: {
					memberConversations: [
						{
							memberId: member.id,
							runtimeSessionId: "leader-runtime",
							history: [
								{
									type: "message",
									entryId: "leader-message",
									message: agentMessage("leader-message", "turn", member.id, "leader", 1).message,
								},
							],
						},
						{
							memberId: reviewer.id,
							runtimeSessionId: "reviewer-runtime",
							history: [
								{
									type: "message",
									entryId: "reviewer-message",
									message: agentMessage("reviewer-message", "turn", reviewer.id, "review", 2).message,
								},
							],
						},
					],
				},
			}),
			pending: undefined,
			streams: {},
			members: [member, reviewer],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
			memberId: member.id,
		});

		expect(items.filter((item) => item.kind === "agent").map((item) => item.text)).toEqual(["leader"]);
		expect(items.some((item) => item.kind === "event")).toBe(false);
	});

	it("accumulates ordered deltas by turn and ignores replayed sequence numbers", () => {
		const first = reduceTeamStreamState({}, streamEvent("turn", 1, "partial"));
		const replayed = reduceTeamStreamState(first, streamEvent("turn", 1, " duplicate"));
		expect(replayed.turn?.message.text).toBe("partial");
	});

	it("reduces interleaved member streams independently by message identity", () => {
		const leader = reduceTeamStreamState({}, streamEvent("leader-message", 1, "lead", "leader"));
		const interleaved = reduceTeamStreamState(
			reduceTeamStreamState(leader, streamEvent("reviewer-message", 1, "review", "reviewer")),
			streamEvent("leader-message", 2, "er", "leader"),
		);

		expect(interleaved["leader-message"]?.message).toMatchObject({ authorId: "leader", text: "leader" });
		expect(interleaved["reviewer-message"]?.message).toMatchObject({ authorId: "reviewer", text: "review" });
	});

	it("restores in-flight text from a reconnect snapshot", () => {
		const state = reduceTeamStreamState(
			{},
			{
				type: "session-snapshot",
				teamSessionId: "session",
				snapshot: snapshot(),
				activeMessageEvents: [streamEvent("turn", 4, "restored partial")],
			},
		);
		expect(state.turn?.message.text).toBe("restored partial");
	});

	it("removes an aborted turn so a cancelled request does not remain pending", () => {
		const state = reduceTeamStreamState(reduceTeamStreamState({}, streamEvent("turn", 1, "partial")), {
			type: "conversation.agent-message-discard",
			conversationId: "session",
			messageId: "turn",
			turnId: "request",
			author: { kind: "agent", id: "leader" },
			sequence: 2,
			reason: "aborted",
			timestamp: 2,
		});
		expect(state.turn).toBeUndefined();
	});

	it("deduplicates optimistic user messages by request id and keeps partial member output visible", () => {
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({ messages: [userMessage("message", "request", "hello", 1)] }),
			pending: { requestId: "request", text: "hello" },
			streams: reduceTeamStreamState({}, streamEvent("turn", 1, "partial")),
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});
		expect(items.filter((item) => item.kind === "user")).toHaveLength(1);
		expect(items.at(-1)).toMatchObject({
			kind: "agent",
			phase: "streaming",
			blocks: [{ text: "partial" }],
		});
	});

	it("keeps the coordination user message visible when member histories are present", () => {
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [userMessage("coord-user", "request", "show this prompt", 1)],
				display: {
					memberConversations: [
						{
							memberId: "leader",
							runtimeSessionId: "leader-runtime",
							history: [
								{
									type: "message",
									entryId: "assistant-entry",
									message: agentMessage("assistant-entry", "request", "leader", "reply", 2).message,
								},
							],
						},
					],
				},
			}),
			pending: { requestId: "request", text: "show this prompt", timestamp: 1 },
			streams: {},
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		expect(items.filter((item) => item.kind === "user")).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: "user", text: "show this prompt", turnId: "request" });
		expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "agent", text: "reply" })]));
	});

	it("keeps aggregated member messages keyed per runtime scope", () => {
		const sharedAssistant = agentMessage("fallback", "request", "leader", "reply", 2).message;
		const reviewer: TeamMemberViewModel = {
			...member,
			id: "reviewer",
			name: "Review",
			handle: "review",
			blueprintId: "reviewer",
		};
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				display: {
					memberConversations: [
						{
							memberId: member.id,
							runtimeSessionId: "leader-runtime",
							history: [{ type: "message", message: sharedAssistant }],
						},
						{
							memberId: reviewer.id,
							runtimeSessionId: "reviewer-runtime",
							history: [{ type: "message", message: sharedAssistant }],
						},
					],
				},
			}),
			pending: undefined,
			streams: {},
			members: [member, reviewer],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		const keys = items.map((item) => item.renderKey ?? item.entryId ?? item.id);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("projects user, delegation, and member output into the shared timeline order", () => {
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				session: { ...session, memberHandles: { leader: "vetta", reviewer: "reviewer" } },
				messages: [
					userMessage("user-event", "request", "Review the launch plan", 1),
					agentMessage("member-event", "request", "reviewer", "Launch risks found", 3),
				],
				activities: [
					{
						kind: "delegation",
						id: "delegation-event",
						requestId: "request",
						sourceMemberId: "leader",
						targetMemberId: "reviewer",
						objective: "Review risks",
						state: "completed",
						timestamp: 2,
					},
				],
			}),
			pending: undefined,
			streams: {},
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		expect(items.map((item) => [item.kind, item.id])).toEqual([
			["user", "user-event"],
			["event", "delegation-event"],
			["agent", "member-event"],
		]);
	});

	it("projects persisted member tool calls into the shared message block contract", () => {
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [
					agentMessage("member-event", "request", "leader", "Read complete", 3, {
						id: "read-call",
						name: "read",
						arguments: { path: "C:/workspace/brief.md" },
					}),
				],
				display: {
					memberConversations: [
						{
							memberId: "leader",
							runtimeSessionId: "leader-runtime",
							history: [
								{
									type: "message",
									entryId: "member-event",
									message: agentMessage("member-event", "request", "leader", "Read complete", 3, {
										id: "read-call",
										name: "read",
										arguments: { path: "C:/workspace/brief.md" },
									}).message,
								},
								{
									type: "message",
									entryId: "tool-result",
									message: {
										role: "toolResult",
										toolCallId: "read-call",
										toolName: "read",
										content: [{ type: "text", text: "file contents" }],
										isError: false,
										timestamp: 4,
									},
								},
							],
						},
					],
				},
			}),
			pending: undefined,
			streams: {},
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		expect(items).toHaveLength(1);
		expect(items[0]).toEqual(
			expect.objectContaining({
				kind: "agent",
				blocks: expect.arrayContaining([
					expect.objectContaining({
						type: "tool_call",
						toolCallId: "read-call",
						toolName: "read",
						args: { path: "C:/workspace/brief.md" },
						status: "success",
						result: "file contents",
						isError: false,
					}),
					expect.objectContaining({ type: "text", text: "Read complete" }),
				]),
			}),
		);
	});

	it("applies live member tool execution events to the shared message block", () => {
		const start: DesktopTeamSessionStreamEvent = {
			type: "desktop.team-tool-execution",
			conversationId: session.id,
			messageId: "live-result",
			turnId: "request",
			author: { kind: "agent", id: member.id },
			sequence: 1,
			timestamp: 1,
			event: { type: "start", toolCallId: "live-call", toolName: "read", args: { path: "README.md" }, startedAt: 1 },
		};
		const end: DesktopTeamSessionStreamEvent = {
			...start,
			sequence: 2,
			timestamp: 3,
			event: {
				type: "end",
				toolCallId: "live-call",
				toolName: "read",
				result: { content: [{ type: "text", text: "done" }] },
				isError: false,
				startedAt: 1,
				durationMs: 2,
				phases: [],
			},
		};

		const state = reduceTeamStreamState(reduceTeamStreamState({}, start), end);
		expect(state["live-result"]?.message.blocks).toEqual([
			expect.objectContaining({
				type: "tool_call",
				toolCallId: "live-call",
				toolName: "read",
				args: { path: "README.md" },
				status: "success",
				result: "done",
			}),
		]);
	});
});
