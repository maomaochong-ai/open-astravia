import { formatDayKey, formatMonthKey, getDayBounds } from "./app-monitor-calendar.js";
import { type AppMonitorData, createDefaultAppMonitorData, normalizeAppMonitorData } from "./app-monitor-data.js";
import type { AppMonitorProfile } from "./app-monitor-profile.js";

export const APP_MONITOR_MONTH_SCHEMA_VERSION = 1;

export interface AppMonitorDayBucket {
	readonly day: string;
	readonly bucketStartUtc: number;
	readonly bucketEndUtc: number;
	readonly coverageStartedAt: number;
	data: AppMonitorData;
}

export interface AppMonitorMonthData {
	readonly schemaVersion: typeof APP_MONITOR_MONTH_SCHEMA_VERSION;
	readonly month: string;
	readonly reportingTimeZone: string;
	readonly deviceId: string;
	readonly createdAt: number;
	updatedAt: number;
	revision: number;
	days: Record<string, AppMonitorDayBucket>;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function normalizeCount(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function createAppMonitorDayBucket(timestamp: number, reportingTimeZone: string): AppMonitorDayBucket {
	const day = formatDayKey(timestamp, reportingTimeZone);
	const bounds = getDayBounds(timestamp, reportingTimeZone);
	const data = createDefaultAppMonitorData(timestamp);
	data.engagement.currentDay = day;
	return {
		day,
		bucketStartUtc: bounds.startUtc,
		bucketEndUtc: bounds.endUtc,
		coverageStartedAt: timestamp,
		data,
	};
}

export function createDefaultAppMonitorMonthData(
	month: string,
	profile: AppMonitorProfile,
	now = Date.now(),
): AppMonitorMonthData {
	return {
		schemaVersion: APP_MONITOR_MONTH_SCHEMA_VERSION,
		month,
		reportingTimeZone: profile.reportingTimeZone,
		deviceId: profile.deviceId,
		createdAt: now,
		updatedAt: now,
		revision: 0,
		days: {},
	};
}

export function normalizeAppMonitorMonthData(
	value: unknown,
	month: string,
	profile: AppMonitorProfile,
): AppMonitorMonthData {
	const raw = asRecord(value);
	const defaults = createDefaultAppMonitorMonthData(month, profile);
	const days: Record<string, AppMonitorDayBucket> = {};
	for (const [dayKey, rawBucket] of Object.entries(asRecord(raw.days))) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || !dayKey.startsWith(`${month}-`)) continue;
		const bucket = asRecord(rawBucket);
		const data = normalizeAppMonitorData(bucket.data);
		data.engagement.currentDay = dayKey;
		const bucketStartUtc = normalizeTimestamp(bucket.bucketStartUtc, 0);
		const bucketEndUtc = normalizeTimestamp(bucket.bucketEndUtc, 0);
		if (bucketStartUtc === 0 || bucketEndUtc <= bucketStartUtc) continue;
		days[dayKey] = {
			day: dayKey,
			bucketStartUtc,
			bucketEndUtc,
			coverageStartedAt: normalizeTimestamp(bucket.coverageStartedAt, bucketStartUtc),
			data,
		};
	}
	return {
		schemaVersion: APP_MONITOR_MONTH_SCHEMA_VERSION,
		month,
		reportingTimeZone: profile.reportingTimeZone,
		deviceId: profile.deviceId,
		createdAt: normalizeTimestamp(raw.createdAt, defaults.createdAt),
		updatedAt: normalizeTimestamp(raw.updatedAt, defaults.updatedAt),
		revision: normalizeCount(raw.revision),
		days,
	};
}

export function getOrCreateAppMonitorDayBucket(monthData: AppMonitorMonthData, timestamp: number): AppMonitorDayBucket {
	const dayKey = formatDayKey(timestamp, monthData.reportingTimeZone);
	monthData.days[dayKey] ??= createAppMonitorDayBucket(timestamp, monthData.reportingTimeZone);
	return monthData.days[dayKey];
}

export function getAppMonitorMonthKey(timestamp: number, profile: AppMonitorProfile): string {
	return formatMonthKey(timestamp, profile.reportingTimeZone);
}
