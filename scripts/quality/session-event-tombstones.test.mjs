import { describe, expect, it } from "vitest";
import { findSessionEventTombstoneViolations } from "./check-session-event-tombstones.mjs";

describe("SessionEvent tombstone guard", () => {
	it("rejects a retired event type even when a cast hides it from the compiler", () => {
		expect(
			findSessionEventTombstoneViolations([
				{
					path: "apps/desktop/src/main/example.test.ts",
					text: 'runtime.emit("rt", { type: "message.delta", delta: "x" } as never);',
				},
			]),
		).toEqual([
			'apps/desktop/src/main/example.test.ts:1: retired SessionEvent "message.delta" — replaced by assistant-channel text_delta (ADR-0146)',
		]);
	});

	it("accepts the live assistant protocol and provider wire names that only look similar", () => {
		expect(
			findSessionEventTombstoneViolations([
				{
					path: "packages/ai/src/providers/anthropic/events.ts",
					text: [
						'if (event.type === "text_delta") {}',
						'case "message_delta":',
						'const kind = "message.deltas";',
					].join("\n"),
				},
			]),
		).toEqual([]);
	});
});
