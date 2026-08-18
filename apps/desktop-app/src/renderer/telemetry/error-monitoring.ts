import * as Sentry from "@sentry/electron/renderer";
import type { ErrorInfo } from "react";
import { redactSensitiveText, redactUrl } from "../../shared/sentry-privacy";
import type { TelemetryContext } from "../../shared/telemetry";

let initialized = false;

export function initializeRendererErrorMonitoring(rendererName: string): void {
	if (initialized || process.env.VETTA_SENTRY_ENABLED !== "true") return;
	try {
		Sentry.init({
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
		Sentry.setTags({ process: "renderer", renderer: rendererName });
		initialized = true;
	} catch {
		initialized = false;
	}
}

export function setRendererTelemetryContext(context: TelemetryContext): void {
	try {
		Sentry.setUser({ id: context.userId ?? context.distinctId });
		Sentry.setContext("telemetry", {
			app_session_id: context.appSessionId,
			posthog_session_id: context.posthogSessionId,
		});
		Sentry.setTag("app_session_id", context.appSessionId);
		if (context.posthogSessionId) Sentry.setTag("posthog_session_id", context.posthogSessionId);
	} catch {
		// Telemetry must not affect renderer state.
	}
}

export function captureReactError(error: unknown, errorInfo: ErrorInfo): void {
	try {
		Sentry.withScope((scope) => {
			scope.setContext("react", { component_stack: errorInfo.componentStack });
			Sentry.captureException(error);
		});
	} catch {
		// Error reporting must not replace the original React error flow.
	}
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
