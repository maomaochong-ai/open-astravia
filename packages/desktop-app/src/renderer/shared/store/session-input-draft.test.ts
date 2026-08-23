import { describe, expect, it } from "vitest";
import {
	emptySessionInputDraft,
	loadSessionInputDraft,
	persistSessionInputDraft,
	prefillNewSessionInputDraft,
} from "./session-input-draft";
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
		expect(isSessionInputDraftEmpty({ text: "  ", appshot: null })).toBe(true);
		expect(isSessionInputDraftEmpty({ text: "@skill:x", appshot: null })).toBe(false);
	});
});

describe("newSessionInputDraftKey", () => {
	it("prefixes cwd", () => {
		expect(newSessionInputDraftKey("C:\\proj")).toBe("new:C:\\proj");
	});
});

describe("prefillNewSessionInputDraft", () => {
	it("预置某个 cwd 的新会话草稿，发送前用户可继续编辑", () => {
		const key = newSessionInputDraftKey("/w/my-app");
		prefillNewSessionInputDraft("/w/my-app", "@skill:astravia-ui-design ");
		expect(loadSessionInputDraft(key).text).toBe("@skill:astravia-ui-design ");
		// 清理，避免污染其它测试。
		persistSessionInputDraft(key, emptySessionInputDraft());
	});
});
