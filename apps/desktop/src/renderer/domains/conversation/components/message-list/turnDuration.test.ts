import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { formatTurnDuration, splitTurnDuration } from "./turnDuration";

const t = ((key: string, values?: Record<string, unknown>) => {
	if (key.endsWith(".hours")) return `${values?.hours}h ${values?.minutes}m`;
	if (key.endsWith(".minutes")) return `${values?.minutes}m ${values?.seconds}s`;
	return `${values?.seconds}s`;
}) as TFunction<"chat">;

describe("turn duration", () => {
	it("normalizes invalid and negative input", () => {
		expect(splitTurnDuration(Number.NaN)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
		expect(splitTurnDuration(-12)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
	});

	it("uses readable second, minute, and hour forms", () => {
		expect(formatTurnDuration(42, t)).toBe("42s");
		expect(formatTurnDuration(128, t)).toBe("2m 08s");
		expect(formatTurnDuration(3788, t)).toBe("1h 03m");
	});
});
