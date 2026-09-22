import { describe, expect, it } from "vitest";
import { emptyTranscript, reduceTranscript, type TranscriptState } from "../src/remote/transcript";

function run(actions: Parameters<typeof reduceTranscript>[1][], initial: TranscriptState = emptyTranscript) {
	return actions.reduce(reduceTranscript, initial);
}

describe("transcript reducer", () => {
	it("loads history into user, assistant and marker items", () => {
		const state = run([
			{
				type: "history",
				entries: [
					{ kind: "user", id: "u1", text: "帮我整理", at: 1 },
					{
						kind: "assistant",
						id: "a1",
						text: "好的",
						thinking: "先搜索",
						toolCalls: [{ toolCallId: "t1", toolName: "web_search", args: "{}", result: "ok", isError: false }],
					},
					{ kind: "marker", id: "m1", text: "上下文已压缩" },
				],
				state: { status: "idle" },
			},
		]);
		expect(state.loaded).toBe(true);
		expect(state.items.map((item) => item.kind)).toEqual(["user", "assistant", "marker"]);
		const assistant = state.items[1];
		expect(assistant.kind === "assistant" && assistant.tools[0]?.status).toBe("done");
		expect(assistant.kind === "assistant" && assistant.thinking).toBe("先搜索");
	});

	it("streams assistant text and thinking into one growing bubble, then finalizes on turn_end", () => {
		const state = run([
			{ type: "message", event: { kind: "user", text: "hi", at: 1 } },
			{ type: "state", state: { status: "running" } },
			{ type: "message", event: { kind: "thinking_delta", text: "想" } },
			{ type: "message", event: { kind: "assistant_delta", text: "你" } },
			{ type: "message", event: { kind: "assistant_delta", text: "好" } },
			{ type: "message", event: { kind: "turn_end", at: 2 } },
			{ type: "state", state: { status: "completed" } },
		]);
		expect(state.items).toHaveLength(2);
		const assistant = state.items[1];
		expect(assistant.kind).toBe("assistant");
		if (assistant.kind !== "assistant") throw new Error("expected assistant");
		expect(assistant.text).toBe("你好");
		expect(assistant.thinking).toBe("想");
		expect(assistant.streaming).toBe(false);
	});

	it("replaces the optimistic local user bubble with the desktop's copy instead of duplicating it", () => {
		const state = run([
			{ type: "local-user", text: "同样的话", at: 1 },
			{ type: "message", event: { kind: "user", text: "同样的话", at: 2 } },
		]);
		expect(state.items).toHaveLength(1);
		expect(state.items[0]?.kind === "user" && state.items[0].at).toBe(2);
	});

	it("tracks tool cards through generating → running → done/failed", () => {
		const base = run([
			{ type: "state", state: { status: "running" } },
			{ type: "tool", event: { toolCallId: "t1", toolName: "web_search", phase: "generating" } },
			{ type: "tool", event: { toolCallId: "t1", toolName: "web_search", phase: "started", args: '{"q":"x"}' } },
			{ type: "tool", event: { toolCallId: "t1", toolName: "web_search", phase: "updated", result: "partial" } },
			{ type: "tool", event: { toolCallId: "t2", toolName: "read", phase: "started" } },
		]);
		const streaming = base.items[0];
		if (streaming?.kind !== "assistant") throw new Error("expected assistant");
		expect(streaming.tools.map((tool) => [tool.toolCallId, tool.status])).toEqual([
			["t1", "running"],
			["t2", "running"],
		]);
		expect(streaming.tools[0]?.args).toBe('{"q":"x"}');
		expect(streaming.tools[0]?.result).toBe("partial");

		const done = run(
			[
				{
					type: "tool",
					event: {
						toolCallId: "t1",
						toolName: "web_search",
						phase: "completed",
						result: "200 OK",
						durationMs: 12,
					},
				},
				{ type: "tool", event: { toolCallId: "t2", toolName: "read", phase: "failed", result: "ENOENT" } },
				{ type: "message", event: { kind: "assistant_delta", text: "done" } },
				{ type: "state", state: { status: "completed" } },
			],
			base,
		);
		const finished = done.items[0];
		if (finished?.kind !== "assistant") throw new Error("expected assistant");
		expect(finished.tools.map((tool) => tool.status)).toEqual(["done", "failed"]);
		expect(finished.tools[0]?.durationMs).toBe(12);
		expect(finished.streaming).toBe(false);
	});

	it("surfaces a pending question and clears it once resolved", () => {
		const request = {
			requestId: "q1",
			questions: [{ question: "继续？", header: "确认", options: [{ label: "是", description: "" }] }],
		};
		const asked = run([
			{ type: "state", state: { status: "running" } },
			{ type: "question", request },
		]);
		expect(asked.pendingQuestion?.requestId).toBe("q1");
		expect(asked.sessionState.status).toBe("waiting_input");
		const resolved = run([{ type: "question-resolved", requestId: "q1" }], asked);
		expect(resolved.pendingQuestion).toBeUndefined();
		expect(resolved.sessionState.status).toBe("running");
		expect(run([{ type: "question-resolved", requestId: "other" }], asked).pendingQuestion?.requestId).toBe("q1");
	});

	it("marks the transcript stale on resync so the owner refetches history", () => {
		const state = run([
			{ type: "message", event: { kind: "user", text: "hi", at: 1 } },
			{ type: "state", state: { status: "running" } },
			{ type: "resync" },
		]);
		expect(state.items).toEqual([]);
		expect(state.stale).toBe(true);
		expect(state.sessionState.status).toBe("running");
	});

	it("attaches the error message to the streaming bubble when a turn fails", () => {
		const state = run([
			{ type: "state", state: { status: "running" } },
			{ type: "message", event: { kind: "assistant_delta", text: "部分" } },
			{ type: "tool", event: { toolCallId: "t1", toolName: "bash", phase: "started" } },
			{ type: "state", state: { status: "error", error: { code: "internal_error", message: "boom" } } },
		]);
		const item = state.items[0];
		if (item?.kind !== "assistant") throw new Error("expected assistant");
		expect(item.error).toBe("boom");
		expect(item.tools[0]?.status).toBe("failed");
	});
});
