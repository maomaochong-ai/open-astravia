import { hookupIpc } from "@sentry/electron/preload-namespaced";
import * as Sentry from "@sentry/electron/renderer";
import { redactSensitiveText, redactUrl } from "../shared/sentry-privacy.js";

if (process.env.VETTA_SENTRY_ENABLED === "true") {
	initializePreloadErrorMonitoring();
}

function initializePreloadErrorMonitoring(): void {
	try {
		hookupIpc();
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
		Sentry.setTag("process", "preload");
	} catch {
		// Telemetry must not prevent preload APIs from being exposed.
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
