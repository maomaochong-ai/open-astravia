import { app, ipcMain } from "electron";
import { PostHog } from "posthog-node";
import type { AppMonitorEvent } from "../../preload/api-types/app-monitor.js";
import { parseTelemetryContext, TELEMETRY_CONTEXT_CHANNEL, type TelemetryContext } from "../../shared/telemetry.js";
import {
	flushMainErrorMonitoring,
	initializeMainErrorMonitoring,
	setMainErrorMonitoringContext,
} from "./error-monitoring.js";
import { toProductEvent } from "./product-events.js";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
let context: TelemetryContext | null = null;
let initialized = false;
let posthogClient: PostHog | null = null;

export function initializeMainTelemetry(options: { enabled: boolean }): void {
	if (initialized || !options.enabled) return;
	const posthogKey = readEnv("VETTA_POSTHOG_KEY");
	const sentryEnabled = readEnv("VETTA_SENTRY_DSN") !== undefined;
	if (!posthogKey && !sentryEnabled) return;
	initialized = true;
	initializeMainErrorMonitoring();

	if (posthogKey) {
		try {
			posthogClient = new PostHog(posthogKey, {
				host: readEnv("VETTA_POSTHOG_HOST") ?? DEFAULT_POSTHOG_HOST,
				enableExceptionAutocapture: false,
				flushInterval: 10_000,
				privacyMode: true,
				isServer: false,
				maxQueueSize: 1_000,
			});
		} catch {
			posthogClient = null;
		}
	}

	ipcMain.on(TELEMETRY_CONTEXT_CHANNEL, handleTelemetryContext);
}

export function captureProductEvent(event: AppMonitorEvent): void {
	if (!posthogClient || !context) return;
	const productEvent = toProductEvent(event);
	capturePostHogEvent(productEvent.name, productEvent.properties);
}

export async function shutdownMainTelemetry(): Promise<void> {
	if (!initialized) return;
	ipcMain.removeListener(TELEMETRY_CONTEXT_CHANNEL, handleTelemetryContext);
	await Promise.allSettled([flushMainErrorMonitoring(), posthogClient?._shutdown(2_000)]);
	posthogClient = null;
	context = null;
	initialized = false;
}

function handleTelemetryContext(_event: Electron.IpcMainEvent, value: unknown): void {
	const nextContext = parseTelemetryContext(value);
	if (!nextContext) return;
	const previousContext = context;
	context = nextContext;
	setMainErrorMonitoringContext(nextContext);

	if (previousContext?.appSessionId !== nextContext.appSessionId) {
		capturePostHogEvent("app_session_started", {
			auth_state: nextContext.userId ? "signed_in" : "anonymous",
		});
	}
	if (previousContext && previousContext.userId !== nextContext.userId) {
		capturePostHogEvent("auth_state_changed", {
			auth_state: nextContext.userId ? "signed_in" : "signed_out",
		});
	}
}

function capturePostHogEvent(name: string, properties: Record<string, boolean | number | string>): void {
	if (!posthogClient || !context) return;
	try {
		posthogClient.capture({
			distinctId: context.distinctId,
			event: name,
			disableGeoip: true,
			properties: {
				...properties,
				app_session_id: context.appSessionId,
				app_version: app.getVersion(),
				platform: process.platform,
				architecture: process.arch,
				...(context.posthogSessionId ? { $session_id: context.posthogSessionId } : {}),
				$process_person_profile: false,
			},
		});
	} catch {
		// Telemetry must not affect product behavior.
	}
}

function readEnv(key: string): string | undefined {
	const value = process.env[key]?.trim();
	return value ? value : undefined;
}
