const DAY_SEARCH_WINDOW_MS = 36 * 60 * 60 * 1000;

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function getDayFormatter(timeZone: string): Intl.DateTimeFormat {
	let formatter = dayFormatters.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("en-CA", {
			calendar: "gregory",
			day: "2-digit",
			month: "2-digit",
			timeZone,
			year: "numeric",
		});
		dayFormatters.set(timeZone, formatter);
	}
	return formatter;
}

export function isValidTimeZone(value: unknown): value is string {
	if (typeof value !== "string" || value.trim() === "") return false;
	try {
		getDayFormatter(value).format(0);
		return true;
	} catch {
		return false;
	}
}

export function resolveSystemTimeZone(): string {
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return isValidTimeZone(timeZone) ? timeZone : "UTC";
}

export function formatDayKey(timestamp: number, timeZone: string): string {
	const parts = getDayFormatter(timeZone).formatToParts(timestamp);
	const year = parts.find((part) => part.type === "year")?.value ?? "0000";
	const month = parts.find((part) => part.type === "month")?.value ?? "00";
	const day = parts.find((part) => part.type === "day")?.value ?? "00";
	return `${year}-${month}-${day}`;
}

export function formatMonthKey(timestamp: number, timeZone: string): string {
	return formatDayKey(timestamp, timeZone).slice(0, 7);
}

export function getPreviousDayKey(timestamp: number, timeZone: string): string {
	return formatDayKey(getDayBounds(timestamp, timeZone).startUtc - 1, timeZone);
}

export function getPreviousMonthKey(timestamp: number, timeZone: string): string {
	return formatMonthKey(getDayBounds(timestamp, timeZone).startUtc - 1, timeZone);
}

export function getDayBounds(
	timestamp: number,
	timeZone: string,
): {
	readonly startUtc: number;
	readonly endUtc: number;
} {
	const dayKey = formatDayKey(timestamp, timeZone);
	return {
		startUtc: findDayStart(timestamp, timeZone, dayKey),
		endUtc: findNextDayStart(timestamp, timeZone, dayKey),
	};
}

function findDayStart(timestamp: number, timeZone: string, dayKey: string): number {
	let lower = timestamp - DAY_SEARCH_WINDOW_MS;
	while (formatDayKey(lower, timeZone) === dayKey) lower -= DAY_SEARCH_WINDOW_MS;
	let upper = timestamp;
	while (upper - lower > 1) {
		const middle = Math.floor((lower + upper) / 2);
		if (formatDayKey(middle, timeZone) === dayKey) upper = middle;
		else lower = middle;
	}
	return upper;
}

function findNextDayStart(timestamp: number, timeZone: string, dayKey: string): number {
	let lower = timestamp;
	let upper = timestamp + DAY_SEARCH_WINDOW_MS;
	while (formatDayKey(upper, timeZone) === dayKey) upper += DAY_SEARCH_WINDOW_MS;
	while (upper - lower > 1) {
		const middle = Math.floor((lower + upper) / 2);
		if (formatDayKey(middle, timeZone) === dayKey) lower = middle;
		else upper = middle;
	}
	return upper;
}
