import { t } from "../i18n/strings";

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
	const diff = Math.max(0, now - timestamp);
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return t.common.justNow;
	if (minutes < 25) return t.common.minutesAgo(minutes);
	if (minutes < 45) return t.common.halfHourAgo;
	const hours = Math.floor(minutes / 60);
	if (hours < 1) return t.common.minutesAgo(minutes);
	if (hours < 24) return t.common.hoursAgo(hours);
	return t.common.daysAgo(Math.floor(hours / 24));
}

export function formatClock(timestamp: number): string {
	const date = new Date(timestamp);
	const hh = String(date.getHours()).padStart(2, "0");
	const mm = String(date.getMinutes()).padStart(2, "0");
	return `${t.common.today} ${hh}:${mm}`;
}
