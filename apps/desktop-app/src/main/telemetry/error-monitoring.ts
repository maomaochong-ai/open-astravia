import * as Sentry from "@sentry/electron/main";
import { app } from "electron";
import { redactSensitiveText, redactUrl } from "../../shared/sentry-privacy.js";
import type { TelemetryContext } from "../../shared/telemetry.js";

let initialized = false;

export function initializeMainErrorMonitoring(): void {
	if (initialized) return;
	const sentryDsn = readEnv("VETTA_SENTRY_DSN");
	if (!sentryDsn) return;
	try {
		Sentry.init({
			dsn: sentryDsn,
			environment: readEnv("VETTA_TELEMETRY_ENVIRONMENT") ?? (app.isPackaged ? "production" : "development"),
			release: readEnv("VETTA_SENTRY_RELEASE") ?? `vetta-desktop@${app.getVersion()}`,
			sendDefaultPii: false,
			attachScreenshot: false,
			tracesSampleRate: parseSampleRate(readEnv("VETTA_SENTRY_TRACES_SAMPLE_RATE")),
			beforeBreadcrumb(breadcrumb) {
				return {
					...breadcrumb,
					message: breadcrumb.message ? redactSensitiveText(breadcrumb.message) : breadcrumb.message,
					data: redactBreadcrumbData(breadcrumb.data),
				};
			},
			beforeSend(event) {
				return {
					...event,
					message: event.message ? redactSensitiveText(event.message) : event.message,
					exception: event.exception
						? {
								...event.exception,
								values: event.exception.values?.map((value) => ({
									...value,
									value: value.value ? redactSensitiveText(value.value) : value.value,
								})),
							}
						: undefined,
					request: event.request
						? {
								...event.request,
								cookies: undefined,
								data: undefined,
								headers: undefined,
								query_string: undefined,
								url: redactUrl(event.request.url),
							}
						: undefined,
					user: event.user?.id ? { id: event.user.id } : undefined,
				};
			},
		});
		Sentry.setTags({ process: "main", platform: process.platform, architecture: process.arch });
		initialized = true;
	} catch {
		initialized = false;
	}
}

export function setMainErrorMonitoringContext(context: TelemetryContext): void {
	try {
		Sentry.setUser({ id: context.userId ?? context.distinctId });
		Sentry.setContext("telemetry", {
			app_session_id: context.appSessionId,
			posthog_session_id: context.posthogSessionId,
		});
		Sentry.setTag("app_session_id", context.appSessionId);
		if (context.posthogSessionId) Sentry.setTag("posthog_session_id", context.posthogSessionId);
	} catch {
		// Telemetry must not affect the application lifecycle.
	}
}

export function flushMainErrorMonitoring(): Promise<boolean> {
	return initialized ? Sentry.flush(2_000) : Promise.resolve(true);
}

function readEnv(key: string): string | undefined {
	const value = process.env[key]?.trim();
	return value ? value : undefined;
}

function parseSampleRate(value: string | undefined): number {
	if (!value) return 0;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
}

function redactBreadcrumbData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	if (!data) return data;
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (/authorization|cookie|secret|token/i.test(key)) continue;
		if (typeof value !== "string") {
			result[key] = value;
			continue;
		}
		result[key] = key.toLowerCase().includes("url") ? redactUrl(value) : redactSensitiveText(value);
	}
	return result;
}
