import { describe, expect, it } from "vitest";
import { formatDocsDate } from "../lib/docs-date";

describe("formatDocsDate", () => {
	it("formats a valid ISO timestamp in Chinese", () => {
		expect(formatDocsDate("2026-03-18T00:00:00.000+08:00")).toBe("2026年3月18日");
	});

	it("returns undefined for missing or invalid values", () => {
		expect(formatDocsDate()).toBeUndefined();
		expect(formatDocsDate("")).toBeUndefined();
		expect(formatDocsDate("not-a-date")).toBeUndefined();
	});
});
