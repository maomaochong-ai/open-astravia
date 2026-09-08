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
	turnId = "request",
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
		turnId,
		author: { kind: "agent", id: authorId },
		sequence,
		timestamp: sequence,
		event: { type: "text_delta", contentIndex: 0, delta, partial },
	};
}

describe("resolveTeamMembers", () => {
	it("assigns a stable avatar when a legacy profile is missing", () => {
		const [resolved] = resolveTeamMembers(undefined, team, [], {}, (_profileId, fallbackHandle) => fallbackHandle);

		expect(resolved?.avatar).toMatch(/agent-team-avatars\/[a-z]+\.webp$/u);
	});
});

describe("team chat stream state", () => {
	it("shows the submitted message and leader immediately before the session snapshot arrives", () => {
		const items = projectTeamConversationTimeline({
			snapshot: undefined,
			pending: {
				requestId: "request-before-runtime",
				text: "Start now",
				leaderMemberId: "leader-member",
				timestamp: 10,
			},
			streams: {},
			members: [],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		expect(items).toEqual([
			expect.objectContaining({ kind: "user", text: "Start now", deliveryPhase: "pending" }),
			expect.objectContaining({ kind: "agent", authorId: "leader-member", phase: "pending" }),
		]);
	});

	it("shows a leader turn that is still thinking, even though it has no visible text yet", () => {
		// A turn that has only produced thinking / tool calls has an empty public text.
		// Deduping streams against persisted replies by text must not treat that empty
		// string as "same content as" some earlier reply that also carried no prose,
		// otherwise the running turn never reaches the feed.
		const thinking = {
			...createAssistantMessage(
				{ api: "agent-team-test", provider: "agent-team-test", model: "fixture" },
				{ timestamp: 1 },
			),
			content: [{ type: "thinking" as const, thinking: "weighing the options" }],
		};
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [
					userMessage("coord-user", "older", "hi", 1),
					// An earlier leader reply that carried a tool call but no prose.
					agentMessage("older-result", "older", "leader", "", 2, {
						id: "call-1",
						name: "team_get_task",
						arguments: {},
					}),
				],
			}),
			pending: undefined,
			streams: reduceTeamStreamState(
				{},
				{
					type: "conversation.agent-message-event",
					conversationId: "session",
					messageId: "team-v1-live",
					turnId: "request",
					author: { kind: "agent", id: "leader" },
					sequence: 1,
					timestamp: 5,
					event: { type: "thinking_delta", contentIndex: 0, delta: "weighing the options", partial: thinking },
				},
			),
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		expect(items.some((item) => item.kind === "agent" && item.id === "team-v1-live")).toBe(true);
	});

	it("does not duplicate a leader turn when live and persisted projections have different ids and text progress", () => {
		const persisted = agentMessage("public-tool-step", "request", "leader", "planning and architecture complete", 2, {
			id: "delegate-call",
			name: "team_delegate_task",
			arguments: { memberId: "executor" },
		});
		const liveToolMessage = agentMessage("live-tool-step", "request", "leader", "planning", 3, {
			id: "delegate-call",
			name: "team_delegate_task",
			arguments: { memberId: "executor" },
		}).message;
		const streams = reduceTeamStreamState(
			{},
			{
				type: "conversation.agent-message-event",
				conversationId: "session",
				messageId: "live-tool-step",
				turnId: "request",
				author: { kind: "agent", id: "leader" },
				sequence: 1,
				timestamp: 3,
				event: { type: "text_delta", contentIndex: 1, delta: "", partial: liveToolMessage },
			},
		);

		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [{ ...persisted, message: { ...persisted.message, stopReason: "toolUse" } }],
				display: {
					memberConversations: [
						{
							memberId: "leader",
							runtimeSessionId: "leader-runtime",
							history: [
								{
									type: "message",
									entryId: "leader-runtime-prompt",
									message: { role: "user", content: "private execution input", timestamp: 0 },
								},
								{
									type: "message",
									entryId: "runtime-tool-step",
									message: persisted.message,
								},
							],
						},
					],
				},
			}),
			pending: undefined,
			streams,
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		expect(items.filter((item) => item.kind === "agent")).toHaveLength(1);
		expect(items).toEqual([
			expect.objectContaining({
				id: "runtime-tool-step",
				renderKey: "team:agent-turn:leader:request",
			}),
		]);
	});

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
		expect(items.some((item) => item.kind === "user")).toBe(false);
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

	it("keeps a completed turn closed when a late stream event arrives", () => {
		const completed = reduceTeamStreamState(reduceTeamStreamState({}, streamEvent("turn", 1, "done")), {
			type: "conversation.agent-message-discard",
			conversationId: "session",
			messageId: "turn",
			turnId: "request",
			author: { kind: "agent", id: "leader" },
			sequence: 2,
			reason: "completed",
			timestamp: 3,
		});

		const late = reduceTeamStreamState(completed, streamEvent("turn", 1, "late"));
		expect(late).toBe(completed);
		expect(late.turn?.message.phase).toBe("completed");
		expect(late.turn?.message.text).toBe("done");
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

	it("keeps visible row identities stable while the first Team turn is normalized", () => {
		const pending = { requestId: "request", text: "hello", leaderMemberId: "leader", timestamp: 1 };
		const labels = { delegation: (from: string, to: string) => `${from} -> ${to}`, unknownMember: "Unknown" };
		const keys = (items: ReturnType<typeof projectTeamConversationTimeline>) =>
			items.map((item) => item.renderKey ?? item.entryId ?? item.id);
		const optimistic = projectTeamConversationTimeline({
			snapshot: undefined,
			pending,
			streams: {},
			members: [member],
			labels,
		});
		const persistedUser = projectTeamConversationTimeline({
			snapshot: snapshot({ messages: [userMessage("persisted-user", "request", "hello", 1)] }),
			pending,
			streams: {},
			members: [member],
			labels,
		});
		const streaming = projectTeamConversationTimeline({
			snapshot: snapshot({ messages: [userMessage("persisted-user", "request", "hello", 1)] }),
			pending,
			streams: reduceTeamStreamState({}, streamEvent("provider-message", 1, "partial")),
			members: [member],
			labels,
		});
		const completed = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [
					userMessage("persisted-user", "request", "hello", 1),
					agentMessage("persisted-agent", "request", "leader", "done", 2),
				],
			}),
			pending: undefined,
			streams: {},
			members: [member],
			labels,
		});

		expect(keys(persistedUser)).toEqual(keys(optimistic));
		expect(keys(streaming)).toEqual(keys(optimistic));
		expect(keys(completed)).toEqual(keys(optimistic));
	});

	it("removes the waiting row as soon as the same pending turn is persisted", () => {
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [
					userMessage("persisted-user", "request", "hello", 1),
					agentMessage("persisted-agent", "request", "leader", "done", 2),
				],
			}),
			pending: { requestId: "request", text: "hello", leaderMemberId: "leader", timestamp: 1 },
			streams: {},
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		const keys = items.map((item) => item.renderKey ?? item.entryId ?? item.id);
		expect(new Set(keys).size).toBe(keys.length);
		expect(items.filter((item) => item.kind === "agent")).toEqual([
			expect.objectContaining({ id: "persisted-agent", phase: "completed" }),
		]);
	});

	it("keeps the public coordination answer visible while member history is still flushing", () => {
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [
					userMessage("coord-user", "request", "hello", 1),
					agentMessage("public-result", "request", "leader", "final answer", 3),
				],
				display: {
					memberConversations: [
						{
							memberId: "leader",
							runtimeSessionId: "leader-runtime",
							history: [
								{
									type: "message",
									entryId: "member-user",
									message: { role: "user", content: "hello", timestamp: 1 },
								},
							],
						},
					],
				},
			}),
			pending: undefined,
			streams: reduceTeamStreamState({}, streamEvent("public-result", 1, "live")),
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		expect(items.filter((item) => item.kind === "agent")).toEqual([
			expect.objectContaining({
				id: "public-result",
				text: "final answer",
				renderKey: "team:agent-turn:leader:request",
			}),
		]);

		const flushed = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [
					userMessage("coord-user", "request", "hello", 1),
					agentMessage("public-result", "request", "leader", "final answer", 3),
				],
				display: {
					memberConversations: [
						{
							memberId: "leader",
							runtimeSessionId: "leader-runtime",
							history: [
								{
									type: "message",
									entryId: "runtime-result",
									message: agentMessage("runtime-result", "runtime-turn", "leader", "final answer", 3).message,
								},
							],
						},
					],
				},
			}),
			pending: undefined,
			streams: reduceTeamStreamState({}, streamEvent("public-result", 2, "final answer")),
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});
		expect(flushed.filter((item) => item.kind === "agent")).toEqual([
			expect.objectContaining({ id: "runtime-result", renderKey: "team:agent-turn:leader:request" }),
		]);
	});

	it("marks tool calls complete in persisted public Team records", () => {
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [
					agentMessage("public-tool-turn", "request", "leader", "", 2, {
						id: "members-call",
						name: "team_list_members",
						arguments: {},
					}),
					agentMessage("public-final", "request", "leader", "已完成", 3),
				],
			}),
			pending: undefined,
			streams: {},
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		const tool = items
			.flatMap((item) => (item.kind === "agent" ? item.blocks : []))
			.find((block) => block.type === "tool_call" && block.toolCallId === "members-call");
		expect(tool).toMatchObject({ type: "tool_call", status: "success" });
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

	it("shows every user message in the aggregate view but only explicit recipients in member views", () => {
		const researcher: TeamMemberViewModel = {
			...member,
			id: "researcher",
			name: "Research",
			handle: "research",
			blueprintId: "researcher",
		};
		const sharedSnapshot = snapshot({
			messages: [
				userMessage("unaddressed", "request-1", "team only", 1),
				userMessage("leader-direct", "request-2", "@vetta direct", 2),
				userMessage("research-direct", "request-3", "@research direct", 3),
			],
			userMessageAnnotations: [
				{
					messageEntryId: "leader-direct",
					participantIds: ["leader"],
					mentions: [{ participantId: "leader", handle: "vetta", start: 0, end: 6 }],
				},
				{
					messageEntryId: "research-direct",
					participantIds: ["researcher"],
					mentions: [{ participantId: "researcher", handle: "research", start: 0, end: 9 }],
				},
			],
		});
		const project = (memberId?: string) =>
			projectTeamConversationTimeline({
				snapshot: sharedSnapshot,
				pending: undefined,
				streams: {},
				members: [member, researcher],
				labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
				...(memberId ? { memberId } : {}),
			});
		const userIds = (items: ReturnType<typeof projectTeamConversationTimeline>) =>
			items.filter((item) => item.kind === "user").map((item) => item.id);

		expect(userIds(project())).toEqual(["unaddressed", "leader-direct", "research-direct"]);
		expect(userIds(project("leader"))).toEqual(["leader-direct"]);
		expect(userIds(project("researcher"))).toEqual(["research-direct"]);
		expect(project()[2]).toMatchObject({
			kind: "user",
			memberMentions: [{ participantId: "researcher", handle: "research", start: 0, end: 9 }],
		});
	});

	it("keeps old coordination user messages aggregate-only when explicit audience metadata is unavailable", () => {
		const legacySnapshot = snapshot({ messages: [userMessage("legacy", "request", "old message", 1)] });
		const memberItems = projectTeamConversationTimeline({
			snapshot: legacySnapshot,
			pending: undefined,
			streams: {},
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
			memberId: "leader",
		});

		expect(memberItems.some((item) => item.kind === "user")).toBe(false);
	});

	it("applies explicit user-message visibility while a Team request is still optimistic", () => {
		const researcher: TeamMemberViewModel = {
			...member,
			id: "researcher",
			name: "Research",
			handle: "research",
			blueprintId: "researcher",
		};
		const projectPending = (
			pending: Parameters<typeof projectTeamConversationTimeline>[0]["pending"],
			memberId?: string,
		) =>
			projectTeamConversationTimeline({
				snapshot: undefined,
				pending,
				streams: {},
				members: [member, researcher],
				labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
				...(memberId ? { memberId } : {}),
			});
		const unaddressed = { requestId: "team-only", text: "team only", leaderMemberId: "leader" };
		const direct = {
			requestId: "direct",
			text: "@research hello",
			targetMemberIds: ["researcher"],
			leaderMemberId: "leader",
		};

		expect(projectPending(unaddressed).some((item) => item.kind === "user")).toBe(true);
		expect(projectPending(unaddressed, "leader").some((item) => item.kind === "user")).toBe(false);
		expect(projectPending(direct, "leader").some((item) => item.kind === "user")).toBe(false);
		expect(projectPending(direct, "researcher").some((item) => item.kind === "user")).toBe(true);
	});

	it("does not merge member runtime user context into the public Team timeline", () => {
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [userMessage("coord-user", "request", "你好", 1)],
				display: {
					memberConversations: [
						{
							memberId: "leader",
							runtimeSessionId: "leader-runtime",
							history: [
								{
									type: "message",
									entryId: "member-user",
									message: { role: "user", content: "你好", timestamp: 1 },
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

		expect(items.filter((item) => item.kind === "user")).toHaveLength(1);
		expect(items[0]).toMatchObject({ id: "coord-user", text: "你好" });
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

	it("does not reuse one public render key for duplicate member history entries", () => {
		const repeated = agentMessage("public-result", "request", "leader", "same answer", 2).message;
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [agentMessage("public-result", "request", "leader", "same answer", 2)],
				display: {
					memberConversations: [
						{
							memberId: "leader",
							runtimeSessionId: "leader-runtime",
							history: [
								{ type: "message", entryId: "member-result-1", message: repeated },
								{
									type: "message",
									entryId: "member-context",
									message: { role: "user", content: "context", timestamp: 2.5 },
								},
								{ type: "message", entryId: "member-result-2", message: repeated },
							],
						},
					],
				},
			}),
			pending: undefined,
			streams: {},
			members: [member],
			memberId: "leader",
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		const keys = items.map((item) => item.renderKey ?? item.entryId ?? item.id);
		expect(new Set(keys).size).toBe(keys.length);
		expect(items.filter((item) => item.kind === "agent")).toHaveLength(2);
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
			members: [
				member,
				{ ...member, id: "reviewer", name: "Reviewer", handle: "reviewer", blueprintId: "reviewer" },
			],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		expect(items.map((item) => [item.kind, item.id])).toEqual([
			["user", "user-event"],
			["event", "delegation-event"],
			["event", "team-member-summary:request:reviewer"],
		]);
		expect(items[2]).toMatchObject({
			event: {
				kind: "team-member-summary",
				memberId: "reviewer",
				state: "completed",
				current: "Launch risks found",
			},
		});
	});

	it("renders a directly addressed member reply as an ordinary agent message", () => {
		const researcher: TeamMemberViewModel = {
			...member,
			id: "researcher",
			name: "Research",
			handle: "research",
			blueprintId: "researcher",
		};
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [
					userMessage("direct-user", "direct-request", "你好", 1),
					agentMessage("direct-reply", "direct-request", "researcher", "你好，我是 Research", 2),
				],
			}),
			pending: undefined,
			streams: {},
			members: [member, researcher],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		expect(items.filter((item) => item.kind === "agent")).toEqual([
			expect.objectContaining({ authorId: "researcher", text: "你好，我是 Research", phase: "completed" }),
		]);
		expect(items.some((item) => item.kind === "event" && item.event.kind === "team-member-summary")).toBe(false);
	});

	it("renders a directly addressed member stream and waiting row as ordinary agent messages", () => {
		const researcher: TeamMemberViewModel = {
			...member,
			id: "researcher",
			name: "Research",
			handle: "research",
			blueprintId: "researcher",
		};
		const pending = {
			requestId: "direct-request",
			text: "你好",
			targetMemberIds: ["researcher"],
			leaderMemberId: "leader",
			timestamp: 1,
		};
		const waiting = projectTeamConversationTimeline({
			snapshot: snapshot(),
			pending,
			streams: {},
			members: [member, researcher],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});
		const streaming = projectTeamConversationTimeline({
			snapshot: snapshot(),
			pending,
			streams: reduceTeamStreamState(
				{},
				streamEvent("direct-stream", 1, "你好，我正在回复", "researcher", "direct-request"),
			),
			members: [member, researcher],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		expect(waiting.filter((item) => item.kind === "agent")).toEqual([
			expect.objectContaining({ authorId: "researcher", phase: "pending" }),
		]);
		expect(streaming.filter((item) => item.kind === "agent")).toEqual([
			expect.objectContaining({ authorId: "researcher", phase: "streaming", text: "你好，我正在回复" }),
		]);
		expect(streaming.some((item) => item.kind === "event" && item.event.kind === "team-member-summary")).toBe(false);
	});

	it("uses a summary card only when the leader delegates to the member", () => {
		const researcher: TeamMemberViewModel = {
			...member,
			id: "researcher",
			name: "Research",
			handle: "research",
			blueprintId: "researcher",
		};
		const reviewer: TeamMemberViewModel = {
			...member,
			id: "reviewer",
			name: "Review",
			handle: "review",
			blueprintId: "reviewer",
		};
		const memberTriggered = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [agentMessage("member-triggered-reply", "member-request", "reviewer", "Review done", 3)],
				activities: [
					{
						kind: "delegation",
						id: "member-triggered",
						requestId: "member-request",
						sourceMemberId: "researcher",
						targetMemberId: "reviewer",
						objective: "Review",
						state: "completed",
						timestamp: 2,
					},
				],
			}),
			pending: undefined,
			streams: {},
			members: [member, researcher, reviewer],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		expect(memberTriggered.filter((item) => item.kind === "agent")).toEqual([
			expect.objectContaining({ authorId: "reviewer", text: "Review done" }),
		]);
		expect(memberTriggered.some((item) => item.kind === "event" && item.event.kind === "team-member-summary")).toBe(
			false,
		);
	});

	it("merges the leader's pre-tool and final provider steps into one completed bubble", () => {
		const preTool = agentMessage("leader-tool-step", "leader-turn", "leader", "", 2, {
			id: "team-send",
			name: "team_send_message",
			arguments: { recipients: ["reviewer"] },
		});
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [
					{ ...preTool, message: { ...preTool.message, stopReason: "toolUse" } },
					agentMessage("leader-final-step", "leader-turn", "leader", "Delegation complete", 3),
				],
				display: { memberConversations: [] },
			}),
			pending: undefined,
			streams: {},
			members: [member],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		const leaderItems = items.filter(
			(item): item is Extract<typeof item, { kind: "agent" }> => item.kind === "agent",
		);
		expect(leaderItems).toHaveLength(1);
		expect(leaderItems[0]).toMatchObject({
			id: "leader-tool-step",
			phase: "completed",
			text: "Delegation complete",
			blocks: expect.arrayContaining([
				expect.objectContaining({ toolCallId: "team-send", status: "success" }),
				expect.objectContaining({ type: "text", text: "Delegation complete" }),
			]),
		});
	});

	it("attaches leader-delegated member activity to the originating tool call", () => {
		const leaderTool = agentMessage("leader-tool", "leader-turn", "leader", "", 2, {
			id: "team-send",
			name: "team_send_message",
			arguments: { recipients: ["reviewer"] },
		});
		const leaderFinal = agentMessage("leader-final", "leader-turn", "leader", "已通知 Review", 3);
		const reviewerResult = agentMessage("reviewer-result", "review-turn", "reviewer", "收到", 4);
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [leaderTool, leaderFinal, reviewerResult],
				activities: [
					{
						kind: "delegation",
						id: "delegation-linked",
						requestId: "review-turn",
						originToolCallId: "team-send",
						sourceMemberId: "leader",
						targetMemberId: "reviewer",
						objective: "通知 Review",
						state: "completed",
						timestamp: 2,
					},
				],
				display: { memberConversations: [] },
			}),
			pending: undefined,
			streams: {},
			members: [member, { ...member, id: "reviewer", name: "Review", handle: "review", blueprintId: "reviewer" }],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		const leader = items.find(
			(item): item is Extract<typeof item, { kind: "agent" }> => item.kind === "agent" && item.authorId === "leader",
		);
		expect(leader?.toolCallPresentations).toEqual([
			expect.objectContaining({
				toolCallId: "team-send",
				activities: [expect.objectContaining({ memberId: "reviewer", state: "completed" })],
			}),
		]);
		expect(items.some((item) => item.kind === "event" && item.event.kind === "delegation")).toBe(false);
		expect(items.some((item) => item.kind === "event" && item.event.kind === "team-member-summary")).toBe(false);
	});

	it("keeps the legacy activity card until the originating leader tool enters the snapshot", () => {
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [agentMessage("reviewer-result", "review-turn", "reviewer", "收到", 4)],
				activities: [
					{
						kind: "delegation",
						id: "delegation-pending-leader-tool",
						requestId: "review-turn",
						originToolCallId: "team-send",
						sourceMemberId: "leader",
						targetMemberId: "reviewer",
						objective: "通知 Review",
						state: "completed",
						timestamp: 2,
					},
				],
				display: { memberConversations: [] },
			}),
			pending: undefined,
			streams: {},
			members: [member, { ...member, id: "reviewer", name: "Review", handle: "review", blueprintId: "reviewer" }],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		expect(items.some((item) => item.kind === "event" && item.event.kind === "delegation")).toBe(true);
		expect(items.some((item) => item.kind === "event" && item.event.kind === "team-member-summary")).toBe(true);
	});

	it("keeps member summary cards in delegation order when replies complete out of order", () => {
		const researcher = { ...member, id: "researcher", name: "Research", handle: "research" };
		const builder = { ...member, id: "builder", name: "Build", handle: "build", blueprintId: "builder" };
		const reviewer = { ...member, id: "reviewer", name: "Review", handle: "review", blueprintId: "reviewer" };
		const messages = [
			agentMessage("research-result", "research-request", "researcher", "Research done", 300),
			agentMessage("build-result", "build-request", "builder", "Build done", 100),
			agentMessage("review-result", "review-request", "reviewer", "Review done", 200),
		];
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages,
				activities: [
					{
						kind: "delegation",
						id: "delegate-research",
						requestId: "research-request",
						sourceMemberId: "leader",
						targetMemberId: "researcher",
						objective: "Research",
						state: "completed",
						timestamp: 10,
					},
					{
						kind: "delegation",
						id: "delegate-build",
						requestId: "build-request",
						sourceMemberId: "leader",
						targetMemberId: "builder",
						objective: "Build",
						state: "completed",
						timestamp: 20,
					},
					{
						kind: "delegation",
						id: "delegate-review",
						requestId: "review-request",
						sourceMemberId: "leader",
						targetMemberId: "reviewer",
						objective: "Review",
						state: "completed",
						timestamp: 30,
					},
				],
				display: {
					memberConversations: messages.map((record) => ({
						memberId: record.author.id,
						runtimeSessionId: `${record.author.id}-runtime`,
						history: [{ type: "message" as const, entryId: record.id, message: record.message }],
					})),
				},
			}),
			pending: undefined,
			streams: {},
			members: [member, researcher, builder, reviewer],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		expect(
			items.flatMap((item) =>
				item.kind === "event" && item.event.kind === "team-member-summary" ? [item.event.memberId] : [],
			),
		).toEqual(["researcher", "builder", "reviewer"]);
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

	it("projects a streaming member into a stable dynamic summary card", () => {
		const reviewer: TeamMemberViewModel = {
			...member,
			id: "reviewer",
			name: "Reviewer",
			handle: "reviewer",
			blueprintId: "reviewer",
		};
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				activities: [
					{
						kind: "delegation",
						id: "delegation-streaming",
						requestId: "request-streaming",
						sourceMemberId: "leader",
						targetMemberId: "reviewer",
						objective: "Review the changes",
						state: "running",
						timestamp: 1,
					},
				],
			}),
			pending: undefined,
			streams: reduceTeamStreamState(
				{},
				streamEvent("reviewer-stream", 2, "正在检查变更", "reviewer", "request-streaming"),
			),
			members: [member, reviewer],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		const summary = items.find(
			(item): item is Extract<typeof item, { kind: "event" }> =>
				item.kind === "event" && item.event.kind === "team-member-summary",
		);
		expect(summary).toMatchObject({
			id: "team-member-summary:request-streaming:reviewer",
			event: {
				state: "streaming",
				current: "正在检查变更",
				currentKind: "text",
			},
		});
	});

	it("prioritizes an in-flight tool over the member's preceding thinking text", () => {
		const reviewer: TeamMemberViewModel = {
			...member,
			id: "reviewer",
			name: "Reviewer",
			handle: "reviewer",
			blueprintId: "reviewer",
		};
		const items = projectTeamConversationTimeline({
			snapshot: snapshot({
				messages: [
					agentMessage("request-tool", "request-tool", "reviewer", "先检查配置", 2, {
						id: "read-call",
						name: "read",
						arguments: { description: "核对项目说明", path: "README.md" },
					}),
				],
				activities: [
					{
						kind: "delegation",
						id: "delegation-tool",
						requestId: "request-tool",
						sourceMemberId: "leader",
						targetMemberId: "reviewer",
						objective: "Read the project brief",
						state: "running",
						timestamp: 1,
					},
				],
			}),
			pending: undefined,
			streams: {},
			members: [member, reviewer],
			labels: { delegation: (from, to) => `${from} -> ${to}`, unknownMember: "Unknown" },
		});

		const summary = items.find(
			(item): item is Extract<typeof item, { kind: "event" }> =>
				item.kind === "event" && item.event.kind === "team-member-summary",
		);
		expect(summary).toMatchObject({ event: { currentKind: "tool", current: "核对项目说明" } });
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
