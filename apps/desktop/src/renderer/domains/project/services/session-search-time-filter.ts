import type { DesktopSessionSearchRequest } from "@/shared/session-search";

export const SESSION_SEARCH_TIME_PRESETS = ["all", "today", "last7Days", "last30Days", "thisMonth", "custom"] as const;
export type SessionSearchTimePreset = (typeof SESSION_SEARCH_TIME_PRESETS)[number];

export interface SessionSearchTimeSelection {
	preset: SessionSearchTimePreset;
	startDate: string;
	endDate: string;
}

export interface SessionSearchTimeRange extends Pick<DesktopSessionSearchRequest, "modifiedFrom" | "modifiedBefore"> {
	error?: "empty" | "invalid" | "reversed";
}

export function parseLocalDate(value: string): Date | undefined {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
	const [year, month, day] = value.split("-").map(Number);
	if (year < 1) return undefined;
	const date = new Date(0);
	date.setHours(0, 0, 0, 0);
	date.setFullYear(year, month - 1, day);
	return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}

export function formatLocalDate(date: Date | undefined): string {
	if (!date) return "";
	return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nextDay(date: Date): number {
	const next = new Date(date);
	// Advance the local calendar, not 24 hours: DST days need not be 24 hours long.
	next.setDate(next.getDate() + 1);
	next.setHours(0, 0, 0, 0);
	return next.getTime();
}

export function resolveSessionSearchTimeRange(
	selection: SessionSearchTimeSelection,
	now = new Date(),
): SessionSearchTimeRange {
	const { preset, startDate, endDate } = selection;
	if (preset === "all") return {};
	if (preset === "custom") {
		if (!startDate && !endDate) return { error: "empty" };
		const start = startDate ? parseLocalDate(startDate) : undefined;
		const end = endDate ? parseLocalDate(endDate) : undefined;
		if ((startDate && !start) || (endDate && !end)) return { error: "invalid" };
		if (start && end && start > end) return { error: "reversed" };
		return { modifiedFrom: start?.getTime(), modifiedBefore: end ? nextDay(end) : undefined };
	}
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const modifiedBefore = nextDay(start);
	if (preset === "last7Days") start.setDate(start.getDate() - 6);
	if (preset === "last30Days") start.setDate(start.getDate() - 29);
	if (preset === "thisMonth") start.setDate(1);
	start.setHours(0, 0, 0, 0);
	return { modifiedFrom: start.getTime(), modifiedBefore };
}
