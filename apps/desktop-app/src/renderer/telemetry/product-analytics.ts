import posthog from "posthog-js";
import type { TelemetryContext } from "../../shared/telemetry";
import { setRendererTelemetryContext } from "./error-monitoring";

const ANONYMOUS_ID_STORAGE_KEY = "vetta-telemetry-anonymous-id";
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
let anonymousId: string | undefined;
let appSessionId: string | undefined;
let currentUserId: string | undefined;
let posthogEnabled = false;
let telemetryEnabled = false;

export function initializeProductAnalytics(): void {
	const apiKey = process.env.VETTA_POSTHOG_KEY?.trim();
	const sentryEnabled = process.env.VETTA_SENTRY_ENABLED === "true";
	if (!apiKey && !sentryEnabled) return;
	telemetryEnabled = true;
	appSessionId = crypto.randomUUID();
	anonymousId = readAnonymousId();
	if (apiKey) {
		try {
			posthog.init(apiKey, {
				api_host: process.env.VETTA_POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST,
				autocapture: false,
				capture_pageview: false,
				capture_pageleave: false,
				capture_exceptions: false,
				disable_session_recording: process.env.VETTA_POSTHOG_REPLAY_ENABLED !== "true",
				person_profiles: "identified_only",
				bootstrap: {
					distinctID: anonymousId,
					isIdentifiedID: false,
				},
				session_recording: {
					maskAllInputs: true,
					maskTextSelector: "*",
					blockSelector: ".ph-no-capture,[data-telemetry-private]",
					recordHeaders: false,
					recordBody: false,
					recordCrossOriginIframes: false,
					captureCanvas: { recordCanvas: false },
					...readReplaySampleRate(),
				},
			});
			posthogEnabled = true;
			posthog.onSessionId(() => syncContext());
		} catch {
			posthogEnabled = false;
		}
	}
	syncContext();
}

export function setProductAnalyticsUser(userId: number | null): void {
	if (!telemetryEnabled) return;
	const nextUserId = userId === null ? undefined : `user:${userId}`;
	if (nextUserId === currentUserId) return;
	currentUserId = nextUserId;
	if (posthogEnabled) {
		try {
			if (nextUserId) {
				posthog.identify(nextUserId);
			} else {
				posthog.reset(true);
				anonymousId = posthog.get_distinct_id();
				localStorage.setItem(ANONYMOUS_ID_STORAGE_KEY, anonymousId);
			}
		} catch {
			posthogEnabled = false;
		}
	}
	syncContext();
}

export function isProductFeatureEnabled(key: string): boolean | undefined {
	return posthogEnabled ? posthog.isFeatureEnabled(key) : undefined;
}

export function onProductFeatureFlags(callback: () => void): () => void {
	return posthogEnabled ? posthog.onFeatureFlags(callback) : () => {};
}

function syncContext(): void {
	if (!telemetryEnabled || !appSessionId || !anonymousId) return;
	const posthogDistinctId = readPostHogValue(() => posthog.get_distinct_id());
	const posthogSessionId = readPostHogValue(() => posthog.get_session_id());
	const context: TelemetryContext = {
		appSessionId,
		distinctId: posthogDistinctId ?? anonymousId,
		...(posthogSessionId ? { posthogSessionId } : {}),
		...(currentUserId ? { userId: currentUserId } : {}),
	};
	setRendererTelemetryContext(context);
	try {
		window.vetta.telemetry.setContext(context);
	} catch {
		// Telemetry IPC must not affect the renderer lifecycle.
	}
}

function readPostHogValue(read: () => string): string | undefined {
	if (!posthogEnabled) return undefined;
	try {
		return read();
	} catch {
		return undefined;
	}
}

function readAnonymousId(): string {
	let stored: string | undefined;
	try {
		stored = localStorage.getItem(ANONYMOUS_ID_STORAGE_KEY)?.trim();
	} catch {
		stored = undefined;
	}
	if (stored) return stored;
	const created = crypto.randomUUID();
	try {
		localStorage.setItem(ANONYMOUS_ID_STORAGE_KEY, created);
	} catch {
		// The in-memory identifier is sufficient when storage is unavailable.
	}
	return created;
}

function readReplaySampleRate(): { sampleRate: number } | Record<string, never> {
	const value = process.env.VETTA_POSTHOG_REPLAY_SAMPLE_RATE?.trim();
	if (!value) return {};
	const parsed = Number(value);
	return Number.isFinite(parsed) ? { sampleRate: Math.min(1, Math.max(0, parsed)) } : {};
}
