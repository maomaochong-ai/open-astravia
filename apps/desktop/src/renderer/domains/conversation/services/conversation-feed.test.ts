// @vitest-environment jsdom

import { conversationItemRenderKey, createConversationUserMessage } from "@shared/conversation";
import {
	type ChatConversationItem,
	type ConversationFeedState,
	createConversationFeedState,
} from "@shared/store/chat-atoms";
import type { AssistantMessage, AssistantMessageEvent } from "@vetta/ai";
import type { HistoryEntry, SessionEvent } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { fullHistoryToChat } from "./chat-service";
import { type ConversationFeedAction, conversationFeedOutbox, reduceConversationFeed } from "./conversation-feed";

const RUNTIME = "runtime-1";
let eventCounter = 0;

function base(timestamp: number) {
	eventCounter += 1;
	return {
		schemaVersion: 1 as const,
		sessionId: RUNTIME,
		eventId: `event-${eventCounter}`,
		timestamp,
	};
}

const turnStarted = (turnId: string, timestamp: number): SessionEvent => ({
	...base(timestamp),
	channel: "runtime",
	source: "runtime-core",
	type: "conversation.turn.started",
	turnId,
});

const turnEnded = (
	type: "conversation.turn.completed" | "conversation.turn.cancelled",
	turnId: string,
	timestamp: number,
): SessionEvent =>
	({
		...base(timestamp),
		channel: "runtime",
		source: "runtime-core",
		type,
		turnId,
		...(type === "conversation.turn.completed" ? { stopReason: "stop" } : {}),
	}) as SessionEvent;

const userAppended = (turnId: string, messageId: string, text: string, timestamp: number): SessionEvent => ({
	...base(timestamp),
	channel: "runtime",
	source: "runtime-core",
	type: "conversation.message.appended",
	turnId,
	messageId,
	message: { role: "user", content: [{ type: "text", text }], timestamp },
});

const modelRequest = (turnId: string, modelCallIndex: number, timestamp: number): SessionEvent => ({
	...base(timestamp),
	channel: "runtime",
	source: "agent",
	type: "model.request.started",
	turnId,
	modelCallIndex,
});

function assistant(content: AssistantMessage["content"], stopReason = "toolUse"): AssistantMessage {
	return { role: "assistant", content, stopReason, timestamp: 0, usage: undefined } as unknown as AssistantMessage;
}

function assistantEvent(turnId: string, modelCallIndex: number, event: AssistantMessageEvent, timestamp: number) {
	return {
		...event,
		...base(timestamp),
		channel: "assistant",
		source: "agent",
		turnId,
		modelCallIndex,
	} as SessionEvent;
}

const textDelta = (turnId: string, call: number, delta: string, timestamp: number) =>
	assistantEvent(
		turnId,
		call,
		{ type: "text_delta", contentIndex: 0, delta, partial: assistant([{ type: "text", text: delta }]) },
		timestamp,
	);

const toolCallStart = (turnId: string, call: number, toolCallId: string, timestamp: number) => {
	const partial = assistant([
		{ type: "text", text: "first" },
		{ type: "toolCall", id: toolCallId, name: "bash", arguments: { command: "ls" } },
	]);
	return assistantEvent(turnId, call, { type: "toolcall_start", contentIndex: 1, partial }, timestamp);
};

const toolStart = (toolCallId: string, timestamp: number): SessionEvent => ({
	...base(timestamp),
	channel: "runtime",
	source: "tool",
	type: "tool.start",
	toolCallId,
	toolName: "bash",
	args: { command: "ls" },
	startedAt: timestamp,
});

const toolEnd = (toolCallId: string, timestamp: number): SessionEvent => ({
	...base(timestamp),
	channel: "runtime",
	source: "tool",
	type: "tool.end",
	toolCallId,
	toolName: "bash",
	result: { content: [{ type: "text", text: "a.txt" }] },
	isError: false,
	startedAt: timestamp - 10,
	durationMs: 10,
	phases: [],
});

function reduce(state: ConversationFeedState, ...actions: ConversationFeedAction[]): ConversationFeedState {
	return actions.reduce(reduceConversationFeed, state);
}

function events(...list: SessionEvent[]): ConversationFeedAction {
	return { type: "runtime.events", runtimeId: RUNTIME, events: list };
}

function optimisticUser(id: string, text: string): ReturnType<typeof createConversationUserMessage> {
	return createConversationUserMessage({ id, text, deliveryPhase: "pending", timestamp: 1 });
}

/** What a user sees: identity, kind, lifecycle and visible content. */
function visible(items: readonly ChatConversationItem[]) {
	return items.map((item) => {
		if (item.kind === "user") return { id: item.id, kind: item.kind, text: item.text };
		if (item.kind === "agent") {
			return {
				id: item.id,
				kind: item.kind,
				phase: item.phase,
				blocks: item.blocks.map((block) =>
					block.type === "tool_call"
						? `${block.type}:${block.toolCallId}:${block.status}`
						: `${block.type}:${"text" in block ? block.text : ""}`,
				),
			};
		}
		return { id: item.id, kind: item.kind };
	});
}

function freshFeed(): ConversationFeedState {
	return createConversationFeedState(RUNTIME);
}

describe("conversation feed", () => {
	it("streams a sent message and its reply into items keyed by Turn identity", () => {
		const state = reduce(
			freshFeed(),
			{ type: "user.sent", message: optimisticUser("u1", "hi") },
			events(
				turnStarted("t1", 10),
				userAppended("t1", "u1", "hi", 11),
				modelRequest("t1", 0, 12),
				textDelta("t1", 0, "hel", 13),
				textDelta("t1", 0, "lo", 14),
				turnEnded("conversation.turn.completed", "t1", 20),
			),
		);

		expect(visible(state.items)).toEqual([
			{ id: "u1", kind: "user", text: "hi" },
			{ id: "assistant:t1:1", kind: "agent", phase: "completed", blocks: ["text:hello"] },
		]);
		expect(state.activeTurnId).toBeNull();
		expect(conversationFeedOutbox(state).visible).toEqual([]);
	});

	it("applies each sequenced Runtime event once", () => {
		const batch = events(
			{ ...turnStarted("t1", 10), sequence: 1 },
			{ ...textDelta("t1", 0, "once", 11), sequence: 2 },
		);
		const once = reduce(freshFeed(), batch);
		expect(reduce(once, batch)).toBe(once);
		expect(visible(once.items)).toEqual([
			{ id: "assistant:t1:0", kind: "agent", phase: "streaming", blocks: ["text:once"] },
		]);
	});

	it("never lets a late terminal event of an old Turn settle the running Turn", () => {
		const state = reduce(
			freshFeed(),
			events(
				turnStarted("t1", 10),
				turnEnded("conversation.turn.completed", "t1", 11),
				turnStarted("t2", 12),
				textDelta("t2", 0, "still going", 13),
				turnEnded("conversation.turn.cancelled", "t1", 14),
			),
		);

		const running = state.items.find((item) => item.id === "assistant:t2:0");
		expect(running).toMatchObject({ phase: "streaming" });
		expect(state.activeTurnId).toBe("t2");
	});

	it("adopts the pending first-send draft without remounting its row", () => {
		const pending = reduce(
			createConversationFeedState(),
			{ type: "user.sent", message: optimisticUser("u1", "hi") },
			{ type: "turn.pending", startedAt: 5 },
		);
		const draftKey = conversationItemRenderKey(pending.items[1]);
		const state = reduce(
			pending,
			{ type: "feed.bound", runtimeId: RUNTIME },
			events(turnStarted("t1", 10), userAppended("t1", "u1", "hi", 11)),
		);

		expect(state.items.map((item) => item.id)).toEqual(["u1", "assistant:t1:1"]);
		expect(conversationItemRenderKey(state.items[1])).toBe(draftKey);
		expect(state.items[1]).toMatchObject({ phase: "streaming", startedAt: 5 });
	});

	it("keeps a queued send's editor snapshot until the Kernel appends it", () => {
		const queued = {
			...optimisticUser("u2", "later"),
			inputSegments: [{ kind: "text" as const, text: "later" }],
		};
		const waiting = reduce(freshFeed(), events(turnStarted("t1", 10)), {
			type: "user.queued",
			runtimeId: RUNTIME,
			message: queued,
		});
		expect(waiting.items.some((item) => item.id === "u2")).toBe(false);

		const state = reduce(waiting, events(userAppended("t1", "u2", "later", 20)));
		const user = state.items.find((item) => item.id === "u2");
		expect(user).toMatchObject({ kind: "user", deliveryPhase: "completed", inputSegments: queued.inputSegments });
		expect(state.queuedUsers).toEqual([]);
		expect(state.items.at(-1)?.id).toBe("assistant:t1:1");
	});

	it("keeps renderer-only items after the item they followed when history arrives", () => {
		const durable = fullHistoryToChat([
			{
				type: "message",
				entryId: "e1",
				messageId: "u1",
				turnId: "t1",
				message: { role: "user", content: "one", timestamp: 1 },
			},
			{ type: "message", entryId: "e2", turnId: "t1", message: assistant([{ type: "text", text: "a" }], "stop") },
		] as HistoryEntry[]);
		const withLocalFailure = reduce(
			freshFeed(),
			{ type: "history.loaded", items: durable, revision: 1 },
			{ type: "user.sent", message: optimisticUser("u2", "rejected") },
			{ type: "user.failed", id: "u2" },
			{ type: "error.appended", message: "No API key", timestamp: 3 },
		);
		const later = fullHistoryToChat([
			...([
				{
					type: "message",
					entryId: "e1",
					messageId: "u1",
					turnId: "t1",
					message: { role: "user", content: "one", timestamp: 1 },
				},
				{ type: "message", entryId: "e2", turnId: "t1", message: assistant([{ type: "text", text: "a" }], "stop") },
				{
					type: "message",
					entryId: "e3",
					messageId: "u3",
					turnId: "t3",
					message: { role: "user", content: "three", timestamp: 4 },
				},
			] as HistoryEntry[]),
		]);

		const state = reduce(withLocalFailure, { type: "history.loaded", items: later, revision: 2 });
		expect(state.items.map((item) => item.id)).toEqual(["u1", "assistant:t1:1", "u2", "local:1", "u3"]);
		expect(conversationFeedOutbox(state).visible).toEqual([]);
	});

	it("merges durable metadata into live rows without changing their DOM keys", () => {
		const live = reduce(
			freshFeed(),
			{ type: "user.sent", message: optimisticUser("u1", "hi") },
			events(
				turnStarted("t1", 10),
				userAppended("t1", "u1", "hi", 11),
				textDelta("t1", 0, "reply", 12),
				turnEnded("conversation.turn.completed", "t1", 20),
			),
		);
		const keys = live.items.map(conversationItemRenderKey);
		const durable = fullHistoryToChat([
			{
				type: "message",
				entryId: "event-7",
				messageId: "u1",
				turnId: "t1",
				message: { role: "user", content: "hi", timestamp: 11 },
			},
			{
				type: "message",
				entryId: "event-8",
				turnId: "t1",
				message: assistant([{ type: "text", text: "reply" }], "stop"),
			},
		] as HistoryEntry[]);

		const state = reduce(live, { type: "history.loaded", runtimeId: RUNTIME, items: durable, revision: 1 });
		expect(state.items.map(conversationItemRenderKey)).toEqual(keys);
		expect(state.items[0]).toMatchObject({ entryId: "event-7", deliveryPhase: "completed" });
		expect(state.items[1]).toMatchObject({ entryId: "event-8", phase: "completed" });
		// Same content under the same deterministic block ids: the block rows are reused too.
		expect(state.items[1]?.kind === "agent" && state.items[1].blocks).toEqual(
			live.items[1]?.kind === "agent" && live.items[1].blocks,
		);
	});

	it("ignores history responses older than the snapshot it applied", () => {
		const newer = reduce(freshFeed(), {
			type: "history.loaded",
			items: [createConversationUserMessage({ id: "u1", text: "new" })],
			revision: 2,
		});
		expect(reduce(newer, { type: "history.loaded", items: [], revision: 1 })).toBe(newer);
	});

	it("ignores writes scoped to another Runtime", () => {
		const state = freshFeed();
		expect(reduce(state, { type: "runtime.events", runtimeId: "runtime-2", events: [turnStarted("t9", 1)] })).toBe(
			state,
		);
	});

	it("rejoining a running Turn shows exactly what staying would have shown", () => {
		const stayed = reduce(
			freshFeed(),
			{ type: "user.sent", message: optimisticUser("u1", "go") },
			events(
				turnStarted("t1", 10),
				userAppended("t1", "u1", "go", 11),
				modelRequest("t1", 0, 12),
				textDelta("t1", 0, "first", 13),
				toolCallStart("t1", 0, "call-1", 14),
				toolStart("call-1", 15),
				toolEnd("call-1", 16),
				modelRequest("t1", 1, 17),
				textDelta("t1", 1, "second", 18),
			),
		);

		// Left after the first model call was persisted; rejoin with history, the running Turn
		// identity from getState, and the relay's in-flight replay.
		const history = fullHistoryToChat([
			{
				type: "message",
				entryId: "e1",
				messageId: "u1",
				turnId: "t1",
				message: { role: "user", content: "go", timestamp: 11 },
			},
			{
				type: "message",
				entryId: "e2",
				turnId: "t1",
				message: assistant([
					{ type: "text", text: "first" },
					{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } },
				]),
			},
			{
				type: "message",
				entryId: "e3",
				turnId: "t1",
				message: { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: "a.txt", timestamp: 16 },
			},
		] as HistoryEntry[]);
		const rejoined = reduce(
			freshFeed(),
			{ type: "history.loaded", runtimeId: RUNTIME, items: history, revision: 1 },
			{ type: "turn.restored", runtimeId: RUNTIME, turnId: "t1", startedAt: 10 },
			events(
				toolStart("call-1", 15),
				toolEnd("call-1", 16),
				modelRequest("t1", 1, 17),
				textDelta("t1", 1, "second", 18),
			),
		);

		expect(visible(rejoined.items)).toEqual(visible(stayed.items));
		expect(rejoined.activeTurnId).toBe("t1");
	});

	it("restoring a continuation Turn never reopens the previous Turn's message", () => {
		const history = fullHistoryToChat([
			{
				type: "message",
				entryId: "e1",
				messageId: "u1",
				turnId: "t1",
				message: { role: "user", content: "go", timestamp: 1 },
			},
			{ type: "message", entryId: "e2", turnId: "t1", message: assistant([{ type: "text", text: "done" }], "stop") },
		] as HistoryEntry[]);
		const state = reduce(
			freshFeed(),
			{ type: "history.loaded", items: history, revision: 1 },
			{ type: "turn.restored", turnId: "t2", startedAt: 50 },
			events(textDelta("t2", 0, "continuing", 51)),
		);

		expect(visible(state.items)).toEqual([
			{ id: "u1", kind: "user", text: "go" },
			{ id: "assistant:t1:1", kind: "agent", phase: "completed", blocks: ["text:done"] },
			{ id: "assistant:t2:0", kind: "agent", phase: "streaming", blocks: ["text:continuing"] },
		]);
	});

	it("keeps live content of the running Turn when history is read mid-Turn", () => {
		const live = reduce(
			freshFeed(),
			events(
				turnStarted("t1", 10),
				userAppended("t1", "u1", "go", 11),
				textDelta("t1", 0, "persisted", 12),
				assistantEvent(
					"t1",
					0,
					{ type: "done", reason: "toolUse", message: assistant([{ type: "text", text: "persisted" }]) },
					13,
				),
				textDelta("t1", 1, " streaming", 14),
			),
		);
		const history = fullHistoryToChat([
			{
				type: "message",
				entryId: "e1",
				messageId: "u1",
				turnId: "t1",
				message: { role: "user", content: "go", timestamp: 11 },
			},
			{
				type: "message",
				entryId: "e2",
				turnId: "t1",
				message: assistant([{ type: "text", text: "persisted" }]),
			},
		] as HistoryEntry[]);

		const state = reduce(live, { type: "history.loaded", items: history, revision: 1 });
		const reply = state.items.find((item) => item.id === "assistant:t1:1");
		expect(reply?.kind === "agent" && reply.text).toBe("persisted streaming");
	});

	it("attaches a Turn failure to that Turn's message, not to the latest one", () => {
		const state = reduce(
			freshFeed(),
			events(turnStarted("t1", 10), turnStarted("t2", 11), {
				...base(12),
				channel: "runtime",
				source: "runtime-core",
				type: "error",
				turnId: "t1",
				retryAttempts: 2,
				error: { code: "PROVIDER_ERROR", message: "rate limited", retryable: true, origin: "provider" },
			} as SessionEvent),
		);
		const failed = state.items.find((item) => item.id === "assistant:t1:0");
		const running = state.items.find((item) => item.id === "assistant:t2:0");
		expect(failed?.kind === "agent" && failed.blocks).toMatchObject([
			{ type: "error", turnId: "t1", text: "rate limited", attempts: 2 },
		]);
		expect(running?.kind === "agent" && running.blocks).toEqual([]);
	});

	it("shows the same local failure once", () => {
		const state = reduce(
			freshFeed(),
			{ type: "user.sent", message: optimisticUser("u1", "hi") },
			{ type: "error.appended", message: "offline", timestamp: 2 },
			{ type: "error.appended", message: "offline", timestamp: 3 },
		);
		const failure = state.items.at(-1);
		expect(failure?.kind === "agent" && failure.blocks.filter((block) => block.type === "error")).toHaveLength(1);
		expect(failure).toMatchObject({ phase: "failed" });
	});

	it("keeps unconfirmed sends in the outbox and drops them once appended", () => {
		const sent = reduce(
			freshFeed(),
			{ type: "user.sent", message: optimisticUser("u1", "hi") },
			{
				type: "user.queued",
				message: optimisticUser("u2", "next"),
			},
		);
		expect(conversationFeedOutbox(sent)).toMatchObject({ visible: [{ id: "u1" }], queued: [{ id: "u2" }] });

		const restored = reduce(createConversationFeedState(), {
			type: "feed.bound",
			runtimeId: RUNTIME,
			outbox: conversationFeedOutbox(sent),
		});
		expect(restored.items.map((item) => item.id)).toEqual(["u1"]);
		expect(restored.queuedUsers.map((user) => user.id)).toEqual(["u2"]);

		const confirmed = reduce(restored, events(turnStarted("t1", 5), userAppended("t1", "u1", "hi", 6)));
		expect(conversationFeedOutbox(confirmed)).toMatchObject({ visible: [], queued: [{ id: "u2" }] });
	});

	it("keeps interleaved thinking, text and tool events in wire order", () => {
		const partial = assistant([
			{ type: "thinking", thinking: "r" },
			{ type: "text", text: "a" },
			{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
		]);
		const state = reduce(
			freshFeed(),
			events(
				turnStarted("t1", 1),
				assistantEvent("t1", 0, { type: "thinking_delta", contentIndex: 0, delta: "r", partial }, 2),
				assistantEvent("t1", 0, { type: "text_delta", contentIndex: 1, delta: "a", partial }, 3),
				assistantEvent("t1", 0, { type: "toolcall_start", contentIndex: 2, partial }, 4),
				assistantEvent("t1", 0, { type: "text_delta", contentIndex: 1, delta: "b", partial }, 5),
			),
		);

		expect(visible(state.items)).toEqual([
			{
				id: "assistant:t1:0",
				kind: "agent",
				phase: "streaming",
				blocks: ["thinking:r", "text:a", "tool_call:call-1:pending", "text:b"],
			},
		]);
	});

	it("keeps events of two Turns delivered interleaved on their own messages", () => {
		const state = reduce(
			freshFeed(),
			events(
				turnStarted("ta", 1),
				userAppended("ta", "ua", "A?", 2),
				turnStarted("tb", 3),
				userAppended("tb", "ub", "B?", 4),
				textDelta("ta", 0, "A", 5),
				textDelta("tb", 0, "B", 6),
			),
		);

		expect(state.items.find((item) => item.id === "assistant:ta:1")).toMatchObject({ text: "A" });
		expect(state.items.find((item) => item.id === "assistant:tb:1")).toMatchObject({ text: "B" });
	});

	it("restores the running Turn's unfinished history tools as pending on the same message", () => {
		const history = fullHistoryToChat([
			{
				type: "message",
				entryId: "e1",
				messageId: "u1",
				turnId: "t1",
				message: { role: "user", content: "go", timestamp: 1 },
			},
			{
				type: "message",
				entryId: "e2",
				turnId: "t1",
				message: assistant([
					{ type: "toolCall", id: "done-call", name: "bash", arguments: {} },
					{ type: "toolCall", id: "open-call", name: "bash", arguments: {} },
				]),
			},
			{
				type: "message",
				entryId: "e3",
				turnId: "t1",
				message: { role: "toolResult", toolCallId: "done-call", toolName: "bash", content: "ok", timestamp: 2 },
			},
		] as HistoryEntry[]);

		const state = reduce(
			freshFeed(),
			{ type: "history.loaded", items: history, revision: 1 },
			{ type: "turn.restored", turnId: "t1", startedAt: 1 },
		);

		expect(visible(state.items)).toEqual([
			{ id: "u1", kind: "user", text: "go" },
			{
				id: "assistant:t1:1",
				kind: "agent",
				phase: "streaming",
				blocks: ["tool_call:done-call:success", "tool_call:open-call:pending"],
			},
		]);
	});

	it("settles a cancelled Turn once however often the cancellation is reported", () => {
		const cancelled = reduce(
			freshFeed(),
			events(turnStarted("t1", 1_000), turnEnded("conversation.turn.cancelled", "t1", 3_000)),
		);
		const again = reduce(cancelled, events(turnEnded("conversation.turn.cancelled", "t1", 9_000)));

		expect(again).toBe(cancelled);
		expect(cancelled.items[0]).toMatchObject({ phase: "aborted", endedAt: 3_000, durationSeconds: 2 });
	});

	it("closes the previous segment when a steering message joins the running Turn", () => {
		const state = reduce(
			freshFeed(),
			events(
				turnStarted("t1", 10),
				userAppended("t1", "u1", "go", 11),
				textDelta("t1", 0, "working", 12),
				userAppended("t1", "u2", "also this", 20),
				textDelta("t1", 1, "sure", 21),
				turnEnded("conversation.turn.completed", "t1", 30),
			),
		);

		expect(visible(state.items)).toEqual([
			{ id: "u1", kind: "user", text: "go" },
			{ id: "assistant:t1:1", kind: "agent", phase: "completed", blocks: ["text:working"] },
			{ id: "u2", kind: "user", text: "also this" },
			{ id: "assistant:t1:2", kind: "agent", phase: "completed", blocks: ["text:sure"] },
		]);
		expect(state.items[1]).toMatchObject({ endedAt: 20 });
		expect(state.items[3]).toMatchObject({ endedAt: 30 });
	});

	it("takes the model a Turn actually used from history and otherwise keeps the one selected at send", () => {
		const sent = reduce(
			freshFeed(),
			{ type: "user.sent", message: { ...optimisticUser("u1", "hi"), model: { provider: "openai", id: "gpt" } } },
			{ type: "user.sent", message: { ...optimisticUser("u2", "hi"), model: { provider: "openai", id: "gpt" } } },
		);
		const history = [
			{ ...createConversationUserMessage({ id: "u1", text: "hi" }), model: { provider: "deepseek", id: "chat" } },
			createConversationUserMessage({ id: "u2", text: "hi" }),
		];

		const state = reduce(sent, { type: "history.loaded", items: history, revision: 1 });
		expect(state.items[0]).toMatchObject({ model: { provider: "deepseek", id: "chat" } });
		expect(state.items[1]).toMatchObject({ model: { provider: "openai", id: "gpt" } });
	});

	it("keeps item objects when a history snapshot changes nothing", () => {
		const history = fullHistoryToChat([
			{
				type: "message",
				entryId: "e1",
				messageId: "u1",
				turnId: "t1",
				message: { role: "user", content: "hi", timestamp: 1 },
			},
			{ type: "message", entryId: "e2", turnId: "t1", message: assistant([{ type: "text", text: "a" }], "stop") },
		] as HistoryEntry[]);
		const shown = reduce(freshFeed(), { type: "history.loaded", items: history, revision: 1 });
		// A second, independently mapped copy of the same history (preview, then Runtime).
		const again = reduce(shown, {
			type: "history.loaded",
			items: fullHistoryToChat([
				{
					type: "message",
					entryId: "e1",
					messageId: "u1",
					turnId: "t1",
					message: { role: "user", content: "hi", timestamp: 1 },
				},
				{ type: "message", entryId: "e2", turnId: "t1", message: assistant([{ type: "text", text: "a" }], "stop") },
			] as HistoryEntry[]),
			revision: 2,
		});

		expect(again.items).toBe(shown.items);
	});

	it("keeps a newly started Turn when history of the previous Turn arrives", () => {
		const live = reduce(
			freshFeed(),
			events(
				turnStarted("t1", 1),
				userAppended("t1", "u1", "one", 2),
				textDelta("t1", 0, "first", 3),
				turnEnded("conversation.turn.completed", "t1", 4),
			),
			{ type: "user.sent", message: optimisticUser("u2", "two") },
			events(turnStarted("t2", 5), userAppended("t2", "u2", "two", 6), textDelta("t2", 0, "sec", 7)),
		);
		const previousTurnOnly = fullHistoryToChat([
			{
				type: "message",
				entryId: "e1",
				messageId: "u1",
				turnId: "t1",
				message: { role: "user", content: "one", timestamp: 2 },
			},
			{
				type: "message",
				entryId: "e2",
				turnId: "t1",
				message: assistant([{ type: "text", text: "first" }], "stop"),
			},
		] as HistoryEntry[]);

		const state = reduce(live, { type: "history.loaded", items: previousTurnOnly, revision: 1 });
		expect(visible(state.items)).toEqual(visible(live.items));
		expect(state.items[0]).toMatchObject({ entryId: "e1" });
	});

	it("keeps the live Turn identity when a history record predates Turn identity", () => {
		const live = reduce(freshFeed(), events(turnStarted("t1", 1), userAppended("t1", "u1", "go", 2)));
		const legacyRecord = fullHistoryToChat([
			{ type: "message", entryId: "u1", message: { role: "user", content: "go", timestamp: 2 } },
		] as HistoryEntry[]);

		const state = reduce(
			live,
			{ type: "history.loaded", items: legacyRecord, revision: 1 },
			events(textDelta("t1", 0, "reply", 3)),
		);
		expect(visible(state.items)).toEqual([
			{ id: "u1", kind: "user", text: "go" },
			{ id: "assistant:t1:1", kind: "agent", phase: "streaming", blocks: ["text:reply"] },
		]);
	});

	it("keeps the editor snapshot of a visible send once history confirms it", () => {
		const segments = [{ kind: "text" as const, text: "hi" }];
		const sent = reduce(freshFeed(), {
			type: "user.sent",
			message: { ...optimisticUser("u1", "hi"), inputSegments: segments },
		});
		const state = reduce(sent, {
			type: "history.loaded",
			items: [createConversationUserMessage({ id: "u1", entryId: "e1", text: "hi" })],
			revision: 1,
		});

		expect(state.items[0]).toMatchObject({ entryId: "e1", deliveryPhase: "completed", inputSegments: segments });
		expect(conversationFeedOutbox(state).visible).toEqual([]);
	});
});
