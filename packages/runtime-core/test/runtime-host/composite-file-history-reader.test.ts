import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../../src/contracts.js";
import { CompositeRuntimeSessionFileHistoryReader } from "../../src/runtime-host/session-services.js";

function marker(customType: string): HistoryEntry[] {
	return [{ type: "custom_marker", customType, timestamp: customType }];
}

describe("CompositeRuntimeSessionFileHistoryReader", () => {
	it("prefers the async entry so opening a session does not block on file I/O", async () => {
		const reader = new CompositeRuntimeSessionFileHistoryReader([
			{
				canRead: (path) => path.endsWith("native.conversation.jsonl"),
				read: () => ({ history: marker("sync") }),
				readAsync: async () => ({ history: marker("async") }),
			},
		]);

		expect((await reader.readAsync("C:/sessions/native.conversation.jsonl")).history).toEqual(marker("async"));
	});

	it("falls back to the synchronous reader when it has no async entry", async () => {
		// 旧格式读取器仍然只有同步实现；打开它的会话时要能照常读到历史，
		// 而不是被判成读不了。
		const reader = new CompositeRuntimeSessionFileHistoryReader([
			{ canRead: (path) => path.endsWith("legacy.jsonl"), read: () => ({ history: marker("legacy") }) },
		]);

		expect((await reader.readAsync("C:/sessions/legacy.jsonl")).history).toEqual(marker("legacy"));
		expect(reader.read("C:/sessions/legacy.jsonl").history).toEqual(marker("legacy"));
	});

	it("rejects a path no reader owns, on both entries", async () => {
		const reader = new CompositeRuntimeSessionFileHistoryReader([
			{ canRead: (path) => path.endsWith("legacy.jsonl"), read: () => ({ history: [] }) },
		]);

		expect(() => reader.read("C:/sessions/unknown.data")).toThrow(/no runtime session history reader/i);
		await expect(reader.readAsync("C:/sessions/unknown.data")).rejects.toThrow(/no runtime session history reader/i);
	});
});
