import type { HistoryEntry } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { selectSessionHistoryPreview } from "./session-history-preview.js";

function message(role: "user" | "assistant", content: string): HistoryEntry {
	if (role === "assistant") {
		return { type: "error", message: content, timestamp: String(Date.now()) };
	}
	return {
		type: "message",
		message: { role: "user", content, timestamp: Date.now() },
	};
}

describe("selectSessionHistoryPreview", () => {
	it("returns the latest complete user turns and all entries that belong to them", () => {
		const history: HistoryEntry[] = [
			message("user", "one"),
			message("assistant", "answer one"),
			message("user", "two"),
			message("assistant", "answer two"),
			{ type: "assistant_turn_timing", timing: { startedAt: 1, endedAt: 2, durationMs: 1 }, timestamp: "2" },
			message("user", "three"),
			message("assistant", "answer three"),
		];

		expect(selectSessionHistoryPreview(history, 2)).toEqual(history.slice(2));
	});

	it("keeps a short history whole when it contains fewer turns than requested", () => {
		const history = [message("user", "one"), message("assistant", "answer one")];
		expect(selectSessionHistoryPreview(history, 2)).toEqual(history);
	});

	it("bounds a preview without user turns", () => {
		const history = Array.from({ length: 40 }, (_, index) => message("assistant", String(index)));
		expect(selectSessionHistoryPreview(history, 2)).toEqual(history.slice(-32));
	});
});
