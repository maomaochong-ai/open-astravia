/** 账户页用量统计的纯计算：区间合计与连续使用天数。 */

export interface UsageDayLike {
	date: string;
	requests: number;
	tokens: number;
}

export interface UsageTotals {
	requests: number;
	tokens: number;
}

/** 本地时区的 YYYY-MM-DD，与序列里的 date 对齐比较。 */
export function usageDayKey(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** days 为 null 时统计整段序列。 */
export function sumUsageTotals(points: UsageDayLike[], days: number | null, now: Date): UsageTotals {
	let cutoff = "";
	if (days !== null) {
		const from = new Date(now);
		from.setDate(from.getDate() - (days - 1));
		cutoff = usageDayKey(from);
	}
	return points.reduce<UsageTotals>(
		(acc, point) => {
			if (cutoff && point.date < cutoff) return acc;
			acc.requests += point.requests;
			acc.tokens += point.tokens;
			return acc;
		},
		{ requests: 0, tokens: 0 },
	);
}

/**
 * 连续使用天数：只要当天有 token 消耗就算用过。今天还没用不打断连续记录，
 * 从昨天往前数（否则每天零点连续记录都会归零）。
 */
export function countUsageStreak(points: UsageDayLike[], now: Date): number {
	const used = new Set(points.filter((point) => point.tokens > 0).map((point) => point.date));
	if (used.size === 0) return 0;

	const cursor = new Date(now);
	if (!used.has(usageDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);

	let streak = 0;
	while (used.has(usageDayKey(cursor))) {
		streak += 1;
		cursor.setDate(cursor.getDate() - 1);
	}
	return streak;
}
