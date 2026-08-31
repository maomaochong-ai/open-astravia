import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSearchTimePreset } from "./session-search-time-filter";
import { formatLocalDate, parseLocalDate, resolveSessionSearchTimeRange } from "./session-search-time-filter";

afterEach(() => vi.unstubAllEnvs());
const initialTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
beforeEach(() => vi.stubEnv("TZ", initialTimezone));

const now = new Date(2026, 0, 3, 15, 30);
const resolve = (preset: SessionSearchTimePreset, startDate = "", endDate = "") =>
	resolveSessionSearchTimeRange({ preset, startDate, endDate }, now);

describe("session search time ranges", () => {
	it.each(["Asia/Shanghai", "America/Los_Angeles", "Pacific/Kiritimati"])(
		"round-trips picker dates as local calendar days in %s",
		(timezone) => {
			vi.stubEnv("TZ", timezone);
			for (const value of ["0001-01-01", "2024-02-29", "2026-08-31", "9999-12-31"]) {
				expect(formatLocalDate(parseLocalDate(value))).toBe(value);
			}
			expect(formatLocalDate(new Date(2026, 7, 31, 23, 59))).toBe("2026-08-31");
			expect(formatLocalDate(undefined)).toBe("");
		},
	);
	it("defaults to unbounded time even if custom dates were previously set", () => {
		expect(resolve("all", "2026-01-01", "2026-01-02")).toEqual({});
	});
	it.each([
		["today", new Date(2026, 0, 3)],
		["last7Days", new Date(2025, 11, 28)],
		["last30Days", new Date(2025, 11, 5)],
		["thisMonth", new Date(2026, 0, 1)],
	] as const)("resolves %s as local calendar days, including today", (preset, start) => {
		expect(resolve(preset)).toEqual({
			modifiedFrom: start.getTime(),
			modifiedBefore: new Date(2026, 0, 4).getTime(),
		});
	});
	it("includes an entire end day and accepts same-day or one-sided ranges", () => {
		expect(resolve("custom", "2024-02-29", "2024-02-29")).toEqual({
			modifiedFrom: new Date(2024, 1, 29).getTime(),
			modifiedBefore: new Date(2024, 2, 1).getTime(),
		});
		expect(resolve("custom", "2026-01-01")).toEqual({ modifiedFrom: new Date(2026, 0, 1).getTime() });
		expect(resolve("custom", "", "2026-01-31")).toEqual({ modifiedBefore: new Date(2026, 1, 1).getTime() });
	});
	it.each([
		["", "", "empty"],
		["2026-02-29", "", "invalid"],
		["2026-13-01", "", "invalid"],
		["2026-1-1", "", "invalid"],
		["0000-01-01", "", "invalid"],
		["2026-01-04", "2026-01-03", "reversed"],
	])("rejects incomplete, invalid and reversed custom dates (%s, %s)", (start, end, error) => {
		expect(resolve("custom", start, end)).toEqual({ error });
	});
	it.each([
		["2026-03-08", 23],
		["2026-11-01", 25],
	] as const)("uses calendar midnight across DST on %s", (day, hours) => {
		vi.stubEnv("TZ", "America/New_York");
		const range = resolve("custom", day, day);
		expect((range.modifiedBefore! - range.modifiedFrom!) / 3_600_000).toBe(hours);
	});
	it("ends at midnight even when a historical timezone transition skipped the start midnight", () => {
		vi.stubEnv("TZ", "America/Sao_Paulo");
		const range = resolve("custom", "2018-11-04", "2018-11-04");
		expect(range.modifiedBefore).toBe(new Date(2018, 10, 5).getTime());
		expect((range.modifiedBefore! - range.modifiedFrom!) / 3_600_000).toBe(23);
	});
});
