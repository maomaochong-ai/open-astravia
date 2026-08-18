import type { ContextCompositionReport } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import {
	type ContextCompositionStorage,
	readCachedContextComposition,
	resolveSessionContextComposition,
	writeCachedContextComposition,
} from "./context-composition-cache";

describe("context composition cache", () => {
	it("restores the latest privacy-safe report for each session", () => {
		const storage = new MemoryStorage();
		writeCachedContextComposition("session-a", report("call-a"), storage);
		writeCachedContextComposition("session-b", report("call-b"), storage);

		expect(readCachedContextComposition("session-a", storage)?.callId).toBe("call-a");
		expect(readCachedContextComposition("session-b", storage)?.callId).toBe("call-b");
	});

	it("falls back to the persisted report when a restarted runtime has no in-memory composition", () => {
		const storage = new MemoryStorage();
		writeCachedContextComposition("session-a", report("before-restart"), storage);

		expect(resolveSessionContextComposition("session-a", undefined, storage)?.callId).toBe("before-restart");
		expect(resolveSessionContextComposition("session-a", report("after-restart"), storage)?.callId).toBe(
			"after-restart",
		);
		expect(readCachedContextComposition("session-a", storage)?.callId).toBe("after-restart");
	});

	it("replaces an older report and keeps only the ten most recent sessions", () => {
		const storage = new MemoryStorage();
		for (let index = 0; index < 12; index += 1) {
			writeCachedContextComposition(`session-${index}`, report(`call-${index}`), storage);
		}
		writeCachedContextComposition("session-11", report("call-new"), storage);

		expect(readCachedContextComposition("session-11", storage)?.callId).toBe("call-new");
		expect(readCachedContextComposition("session-0", storage)).toBeUndefined();
		expect(readCachedContextComposition("session-2", storage)?.callId).toBe("call-2");
	});

	it("rejects malformed persisted reports instead of trusting local storage", () => {
		const storage = new MemoryStorage();
		storage.setItem(
			"vetta-context-composition-cache-v1",
			JSON.stringify({ version: 1, entries: [{ sessionPath: "session-a", report: { version: 1 } }] }),
		);

		expect(readCachedContextComposition("session-a", storage)).toBeUndefined();
	});
});

class MemoryStorage implements ContextCompositionStorage {
	private readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}
}

function report(callId: string): ContextCompositionReport {
	return {
		version: 1,
		callId,
		snapshotId: "snapshot-1",
		phase: "completed",
		createdAt: 1,
		model: { provider: "openai", modelId: "gpt-test", contextWindow: 1_000 },
		estimate: { tokens: 10, knownTokens: 10, coverage: "complete" },
		providerReportedInputTokens: 12,
		sections: [
			{
				id: "instruction:base",
				kind: "instruction",
				category: "base",
				source: { owner: "core", id: "base" },
				estimatedTokens: 10,
				estimateMethod: "heuristic",
				percentOfWindow: 1,
			},
		],
	};
}
