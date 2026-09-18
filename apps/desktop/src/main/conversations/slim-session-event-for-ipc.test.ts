import { type AssistantMessage, createAssistantMessage } from "@vetta/ai";
import type { AssistantSessionEvent, SessionEvent } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { decodeSessionEvent } from "../../shared/session-event-codec.js";
import { SLIM_ASSISTANT_PARTIAL, slimSessionEventForIpc } from "./slim-session-event-for-ipc.js";

function fatPartial(): AssistantMessage {
	return {
		...createAssistantMessage(
			{ api: "openai-completions", provider: "openai", model: "gpt-test" },
			{ timestamp: 10 },
		),
		content: [{ type: "text", text: "hello ".repeat(2_000) }],
	};
}

function assistantDelta(
	type: "text_delta" | "thinking_delta" | "toolcall_delta",
	partial: AssistantMessage,
): AssistantSessionEvent {
	return {
		schemaVersion: 1,
		sessionId: "session-1",
		eventId: "event-1",
		timestamp: 10,
		source: "agent",
		sequence: 3,
		channel: "assistant",
		turnId: "turn-1",
		modelCallIndex: 0,
		type,
		contentIndex: 0,
		delta: "x",
		partial,
	};
}

describe("slimSessionEventForIpc", () => {
	it("strips growing text and thinking partials while keeping the delta for the renderer", () => {
		const partial = fatPartial();
		const textEvent = assistantDelta("text_delta", partial);
		const slimed = slimSessionEventForIpc(textEvent);

		expect(slimed).not.toBe(textEvent);
		if (textEvent.type !== "text_delta") throw new Error("expected assistant text_delta");
		expect(textEvent.partial).toBe(partial);
		expect(slimed).toMatchObject({ type: "text_delta", delta: "x" });
		if (slimed.channel !== "assistant" || slimed.type !== "text_delta") {
			throw new Error("expected assistant text_delta");
		}
		expect(slimed.partial).toBe(SLIM_ASSISTANT_PARTIAL);
		expect(decodeSessionEvent(slimed)).toBe(slimed);

		const thinking = slimSessionEventForIpc(assistantDelta("thinking_delta", partial));
		if (thinking.channel !== "assistant" || thinking.type !== "thinking_delta") {
			throw new Error("expected assistant thinking_delta");
		}
		expect(thinking.partial).toBe(SLIM_ASSISTANT_PARTIAL);
		expect(decodeSessionEvent(thinking)).toBe(thinking);
	});

	it("keeps tool-call partials and non-assistant deltas intact", () => {
		const partial = fatPartial();
		const toolEvent = assistantDelta("toolcall_delta", partial);
		expect(slimSessionEventForIpc(toolEvent)).toBe(toolEvent);
		if (toolEvent.type !== "toolcall_delta") throw new Error("expected assistant toolcall_delta");
		expect(toolEvent.partial.content[0]).toEqual({ type: "text", text: "hello ".repeat(2_000) });

		const runtimeDelta: SessionEvent = {
			schemaVersion: 1,
			sessionId: "session-1",
			eventId: "event-2",
			timestamp: 11,
			source: "agent",
			type: "message.delta",
			delta: "plain",
		};
		expect(slimSessionEventForIpc(runtimeDelta)).toBe(runtimeDelta);
	});
});
