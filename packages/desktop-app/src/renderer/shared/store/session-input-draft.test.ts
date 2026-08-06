import { describe, expect, it } from "vitest";
import {
	appendInputHistoryEntry,
	INPUT_HISTORY_MAX,
	isSessionInputDraftEmpty,
	newSessionInputDraftKey,
} from "./session-input-draft-logic";

describe("appendInputHistoryEntry", () => {
	it("skips empty / whitespace", () => {
		expect(appendInputHistoryEntry([], "")).toEqual([]);
		expect(appendInputHistoryEntry([], "  \n")).toEqual([]);
		expect(appendInputHistoryEntry(["a"], "   ")).toEqual(["a"]);
	});

	it("appends trimmed text", () => {
		expect(appendInputHistoryEntry([], "  hello  ")).toEqual(["hello"]);
		expect(appendInputHistoryEntry(["a"], "b")).toEqual(["a", "b"]);
	});

	it("dedupes consecutive duplicates", () => {
		expect(appendInputHistoryEntry(["a", "b"], "b")).toEqual(["a", "b"]);
		expect(appendInputHistoryEntry(["a", "b"], "B")).toEqual(["a", "b", "B"]);
	});

	it("caps length from the front", () => {
		const filled = Array.from({ length: INPUT_HISTORY_MAX }, (_, i) => `m${i}`);
		const next = appendInputHistoryEntry(filled, "newest");
		expect(next).toHaveLength(INPUT_HISTORY_MAX);
		expect(next[0]).toBe("m1");
		expect(next[next.length - 1]).toBe("newest");
	});
});

describe("isSessionInputDraftEmpty", () => {
	it("treats whitespace-only text without skill/appshot as empty", () => {
		expect(isSessionInputDraftEmpty({ text: "  ", selectedSkill: null, appshot: null })).toBe(true);
		expect(
			isSessionInputDraftEmpty({
				text: "",
				selectedSkill: { name: "x", type: "skill" },
				appshot: null,
			}),
		).toBe(false);
	});
});

describe("newSessionInputDraftKey", () => {
	it("prefixes cwd", () => {
		expect(newSessionInputDraftKey("C:\\proj")).toBe("new:C:\\proj");
	});
});
