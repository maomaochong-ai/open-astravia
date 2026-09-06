import { describe, expect, it } from "vitest";
import { ANALYZE_CONTEXT_CHAR_LIMIT, ANALYZE_SQL_CHAR_LIMIT, clipToLimit } from "./analyze-context";

describe("clipToLimit", () => {
	it("短文本原样返回且未截断", () => {
		const r = clipToLimit("select 1", ANALYZE_SQL_CHAR_LIMIT);
		expect(r).toEqual({ text: "select 1", truncated: false });
	});

	it("空串原样返回", () => {
		expect(clipToLimit("", ANALYZE_SQL_CHAR_LIMIT)).toEqual({ text: "", truncated: false });
	});

	it("恰好等于上限时不截断", () => {
		const s = "a".repeat(ANALYZE_SQL_CHAR_LIMIT);
		expect(clipToLimit(s, ANALYZE_SQL_CHAR_LIMIT).truncated).toBe(false);
	});

	it("超长截断到上限并标记 truncated", () => {
		const s = "x".repeat(ANALYZE_SQL_CHAR_LIMIT + 100);
		const r = clipToLimit(s, ANALYZE_SQL_CHAR_LIMIT);
		expect(r.truncated).toBe(true);
		expect(r.text.length).toBe(ANALYZE_SQL_CHAR_LIMIT);
		expect(r.text).toBe("x".repeat(ANALYZE_SQL_CHAR_LIMIT));
	});

	it("多字节字符按字符数截断不产生半个代理对", () => {
		const s = "中".repeat(ANALYZE_CONTEXT_CHAR_LIMIT + 5);
		const r = clipToLimit(s, ANALYZE_CONTEXT_CHAR_LIMIT);
		expect(r.truncated).toBe(true);
		expect(r.text.length).toBe(ANALYZE_CONTEXT_CHAR_LIMIT);
		expect(r.text).toBe("中".repeat(ANALYZE_CONTEXT_CHAR_LIMIT));
	});
});
