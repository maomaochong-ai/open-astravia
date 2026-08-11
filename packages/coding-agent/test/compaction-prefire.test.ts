import { describe, expect, test } from "vitest";
import {
	DEFAULT_COMPACTION_SETTINGS,
	fingerprintCompactionPrefix,
	getCompactThreshold,
	isPrefireCacheValid,
	PREFIRE_LEAD_PERCENT,
	type PrefireCache,
	shouldPrefire,
} from "../src/compaction/index.js";
import type { CodingAgentSessionEntry as SessionEntry } from "../src/sessions/index.js";

function entry(id: string, type = "message"): SessionEntry {
	return { id, type } as unknown as SessionEntry;
}

function compactionEntry(id: string): SessionEntry {
	return { id, type: "compaction" } as unknown as SessionEntry;
}

describe("fingerprintCompactionPrefix", () => {
	test("stable for identical prefix, changes when prefix changes", () => {
		const entries = [entry("a"), entry("b"), entry("c"), entry("d")];
		const fp1 = fingerprintCompactionPrefix(entries, "c");
		const fp2 = fingerprintCompactionPrefix([entry("a"), entry("b"), entry("c"), entry("e")], "c");
		expect(fp1).toBeDefined();
		// 前缀（a,b）与 firstKept（c）相同 → 指纹一致，尾部差异不影响
		expect(fp2).toBe(fp1);
		const fp3 = fingerprintCompactionPrefix([entry("a"), entry("X"), entry("c"), entry("d")], "c");
		expect(fp3).not.toBe(fp1);
	});

	test("undefined when firstKeptEntryId is not on the branch", () => {
		expect(fingerprintCompactionPrefix([entry("a"), entry("b")], "zzz")).toBeUndefined();
	});

	test("prefix starts after the last compaction entry", () => {
		const before = [entry("a"), entry("b"), entry("c"), entry("d")];
		const after = [entry("a"), compactionEntry("comp"), entry("b"), entry("c"), entry("d")];
		// boundary 变化 → 覆盖的前缀不同 → 指纹不同
		expect(fingerprintCompactionPrefix(after, "d")).not.toBe(fingerprintCompactionPrefix(before, "d"));
	});

	test("undefined when firstKept falls before the last compaction boundary", () => {
		const entries = [entry("a"), entry("b"), compactionEntry("comp"), entry("c")];
		expect(fingerprintCompactionPrefix(entries, "a")).toBeUndefined();
	});
});

describe("isPrefireCacheValid", () => {
	function cacheFor(entries: SessionEntry[], firstKept: string): PrefireCache {
		const fingerprint = fingerprintCompactionPrefix(entries, firstKept);
		if (!fingerprint) throw new Error("test setup: fingerprint undefined");
		return {
			fingerprint,
			result: { summary: "s", firstKeptEntryId: firstKept, tokensBefore: 100, details: undefined },
		};
	}

	test("valid when prefix unchanged even after new tail messages", () => {
		const atPrefire = [entry("a"), entry("b"), entry("c")];
		const cache = cacheFor(atPrefire, "c");
		const atTrigger = [...atPrefire, entry("d"), entry("e")];
		expect(isPrefireCacheValid(cache, atTrigger)).toBe(true);
	});

	test("invalid after rewind/branch (prefix changed)", () => {
		const cache = cacheFor([entry("a"), entry("b"), entry("c")], "c");
		expect(isPrefireCacheValid(cache, [entry("a"), entry("X"), entry("c"), entry("d")])).toBe(false);
	});

	test("invalid when branch already ends with a compaction", () => {
		const atPrefire = [entry("a"), entry("b"), entry("c")];
		const cache = cacheFor(atPrefire, "c");
		expect(isPrefireCacheValid(cache, [...atPrefire, compactionEntry("comp")])).toBe(false);
	});

	test("invalid on empty branch", () => {
		const cache = cacheFor([entry("a"), entry("b"), entry("c")], "c");
		expect(isPrefireCacheValid(cache, [])).toBe(false);
	});
});

describe("shouldPrefire", () => {
	const window = 200_000;
	const settings = DEFAULT_COMPACTION_SETTINGS;
	const threshold = getCompactThreshold(window, settings);
	const lead = Math.floor((window * PREFIRE_LEAD_PERCENT) / 100);

	test("fires inside the lead band, not before, not at threshold", () => {
		expect(shouldPrefire(threshold - lead - 1, window, settings)).toBe(false);
		expect(shouldPrefire(threshold - lead, window, settings)).toBe(true);
		expect(shouldPrefire(threshold - 1, window, settings)).toBe(true);
		expect(shouldPrefire(threshold, window, settings)).toBe(false);
	});

	test("never fires without a context window", () => {
		expect(shouldPrefire(1000, 0, settings)).toBe(false);
	});
});
