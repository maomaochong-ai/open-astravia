import { describe, expect, it, vi } from "vitest";
import { parseCronExpression, type Schedule, toCronExpression } from "./cron-utils";

describe("scheduler cron conversion", () => {
	it.each<Schedule>([
		{ mode: "daily", hour: 9, minute: 15 },
		{ mode: "weekly", weekdays: new Set([1, 3, 5]), hour: 18, minute: 30 },
		{ mode: "interval", intervalHours: 4 },
		{ mode: "interval", intervalHours: 24 },
	])("round-trips schedules produced by the picker", (schedule) => {
		expect(parseCronExpression(toCronExpression(schedule), false)).toEqual(schedule);
	});

	it("round-trips a one-time schedule without changing its calendar date", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2028, 0, 1, 10, 0));
		const schedule: Schedule = {
			mode: "once",
			year: 2028,
			month: 6,
			day: 20,
			hour: 8,
			minute: 5,
		};

		expect(parseCronExpression(toCronExpression(schedule), true)).toEqual(schedule);
		vi.useRealTimers();
	});

	it.each(["60 9 * * *", "0 24 * * *", "0 9 * * 7", "0 */0 * * *", "0 */two * * *", "*/30 * * * *"])(
		"rejects unsupported or out-of-range expressions instead of changing their meaning: %s",
		(cron) => {
			expect(parseCronExpression(cron, false)).toBeNull();
		},
	);
});
