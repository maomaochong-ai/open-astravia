import { randomUUID } from "node:crypto";
import { isValidTimeZone, resolveSystemTimeZone } from "./app-monitor-calendar.js";

export const APP_MONITOR_PROFILE_SCHEMA_VERSION = 1;

export interface AppMonitorProfile {
	readonly schemaVersion: typeof APP_MONITOR_PROFILE_SCHEMA_VERSION;
	readonly createdAt: number;
	readonly deviceId: string;
	readonly reportingTimeZone: string;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function normalizeTimestamp(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizeDeviceId(value: unknown): string {
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	return /^[a-zA-Z0-9_-]{1,128}$/.test(trimmed) ? trimmed : "";
}

export function createDefaultAppMonitorProfile(now = Date.now()): AppMonitorProfile {
	return {
		schemaVersion: APP_MONITOR_PROFILE_SCHEMA_VERSION,
		createdAt: now,
		deviceId: randomUUID(),
		reportingTimeZone: resolveSystemTimeZone(),
	};
}

export function normalizeAppMonitorProfile(value: unknown): AppMonitorProfile {
	const profile = asRecord(value);
	const defaults = createDefaultAppMonitorProfile();
	return {
		schemaVersion: APP_MONITOR_PROFILE_SCHEMA_VERSION,
		createdAt: normalizeTimestamp(profile.createdAt, defaults.createdAt),
		deviceId: normalizeDeviceId(profile.deviceId) || defaults.deviceId,
		reportingTimeZone: isValidTimeZone(profile.reportingTimeZone)
			? profile.reportingTimeZone
			: defaults.reportingTimeZone,
	};
}
