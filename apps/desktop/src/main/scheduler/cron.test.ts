import { describe, expect, it } from "vitest";
import { isValidCronExpression, nextFireTime, summarizeFireTimes } from "./cron.js";

const at = (day: number, hour: number, minute = 0) => new Date(2026, 0, day, hour, minute).getTime();

describe("automation schedule timing", () => {
	it("counts the fire times missed inside a window and folds them into one summary", () => {
		expect(summarizeFireTimes({ kind: "hourly", minute: 0 }, at(20, 0, 30), at(20, 9, 10))).toEqual({
			count: 9,
			first: at(20, 1),
			last: at(20, 9),
		});
		expect(summarizeFireTimes({ kind: "daily", hour: 9, minute: 0 }, at(20, 10), at(20, 23))).toBeNull();
	});

	it("treats the month's last day and one-time moments as real fire times", () => {
		expect(nextFireTime({ kind: "monthly", days: ["last"], hour: 9, minute: 30 }, at(20, 0))).toBe(at(31, 9, 30));
		expect(summarizeFireTimes({ kind: "once", at: at(21, 8) }, at(20, 0), at(22, 0))).toEqual({
			count: 1,
			first: at(21, 8),
			last: at(21, 8),
		});
		expect(nextFireTime({ kind: "once", at: at(19, 8) }, at(20, 0))).toBeNull();
	});

	it("accepts only five-field cron expressions", () => {
		expect(isValidCronExpression("*/15 9-18 * * 1-5")).toBe(true);
		expect(isValidCronExpression("0 0 9 * * *")).toBe(false);
		expect(isValidCronExpression("not a cron")).toBe(false);
	});
});
