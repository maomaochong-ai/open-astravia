import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "../src/board/relative-time";

const NOW = new Date("2026-08-11T12:00:00").getTime();

describe("formatRelativeTime", () => {
	it("一分钟内是「刚刚」", () => {
		expect(formatRelativeTime(NOW, NOW - 30_000, "zh")).toBe("刚刚");
		expect(formatRelativeTime(NOW, NOW - 30_000, "en-US")).toBe("just now");
	});

	it("分钟 / 小时 / 天梯度", () => {
		expect(formatRelativeTime(NOW, NOW - 5 * 60_000, "zh")).toBe("5 分钟前");
		expect(formatRelativeTime(NOW, NOW - 3 * 3_600_000, "zh")).toBe("3 小时前");
		expect(formatRelativeTime(NOW, NOW - 2 * 86_400_000, "en")).toBe("2d ago");
	});

	it("超过 7 天退化为日期", () => {
		const old = new Date("2026-07-02T08:00:00").getTime();
		expect(formatRelativeTime(NOW, old, "zh")).toBe("7 月 2 日");
		expect(formatRelativeTime(NOW, old, "en")).toBe("7/2");
	});

	it("未来时间戳按 0 处理，不出现负数", () => {
		expect(formatRelativeTime(NOW, NOW + 60_000, "zh")).toBe("刚刚");
	});
});
