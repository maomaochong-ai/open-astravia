import { describe, expect, it } from "vitest";
import { isSpeechHostEvent } from "./protocol.js";

describe("isSpeechHostEvent", () => {
	it("accepts the documented host events", () => {
		expect(isSpeechHostEvent({ type: "initialized" })).toBe(true);
		expect(isSpeechHostEvent({ type: "partial", sessionId: "s1", text: "你好" })).toBe(true);
		expect(isSpeechHostEvent({ type: "error", code: "recognizer-failed" })).toBe(true);
	});

	it("rejects malformed or unknown events", () => {
		expect(isSpeechHostEvent({ type: "partial", sessionId: "s1" })).toBe(false);
		expect(isSpeechHostEvent({ type: "error", code: "arbitrary-code" })).toBe(false);
		expect(isSpeechHostEvent(null)).toBe(false);
	});
});
