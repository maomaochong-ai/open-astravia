/**
 * 「三天前」这类相对时间。
 *
 * 用 Intl.RelativeTimeFormat 而不是往 locales 里塞一堆「x 分钟前」的模板：复数、词序
 * 这些事它已经按语言处理好了，自己拼只会在英文下拼错。
 */
const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
	{ unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
	{ unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
	{ unit: "day", ms: 24 * 60 * 60 * 1000 },
	{ unit: "hour", ms: 60 * 60 * 1000 },
	{ unit: "minute", ms: 60 * 1000 },
];

/** 一分钟以内不报数字，交给调用方用「刚刚」这类文案。 */
export const JUST_NOW_MS = 60 * 1000;

export function formatRelativeTime(timestamp: number, locale: string, now: number = Date.now()): string | null {
	if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
	const elapsed = now - timestamp;
	if (elapsed < JUST_NOW_MS) return null;
	const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
	for (const { unit, ms } of UNITS) {
		if (elapsed >= ms) return format.format(-Math.floor(elapsed / ms), unit);
	}
	return null;
}
