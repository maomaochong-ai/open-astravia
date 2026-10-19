import * as Sentry from "@sentry/electron/renderer";
import type { ErrorInfo } from "react";
import { redactSensitiveText, redactUrl } from "../../shared/sentry-privacy";
import type { TelemetryContext } from "../../shared/telemetry";
import { rememberReactComponentStack } from "../shared/lib/react-error-details";

let initialized = false;

export function initializeRendererErrorMonitoring(rendererName: string): void {
	if (initialized || process.env.ASTRAVIA_SENTRY_ENABLED !== "true") return;
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
	// Sentry 默认关闭（ASTRAVIA_SENTRY_ENABLED），而组件栈是 React #185 这类错误唯一能指认
	// 循环组件的信息。先记住它给错误页用，再落到渲染日志（renderer console 会被主进程落盘）。
	rememberReactComponentStack(error, errorInfo.componentStack);
	logReactError(error, errorInfo.componentStack);
	try {
		Sentry.withScope((scope) => {
			scope.setContext("react", { component_stack: errorInfo.componentStack });
			Sentry.captureException(error);
		});
	} catch {
		// Error reporting must not replace the original React error flow.
	}
}

/**
 * 把 React 捕获到的错误连同组件栈写进 console —— 渲染进程 console 由主进程落盘到
 * `desktop-app/logs/render/*.log`。生产构建的 React 只给编号（#185 之类），组件栈是唯一能
 * 指出「哪个组件在循环」的信息，不能只送给默认关闭的 Sentry。
 */
function logReactError(error: unknown, componentStack: string | null | undefined): void {
	try {
		const reason = error instanceof Error ? error.message : String(error);
		const stack = componentStack?.trim();
		console.error("[react error]", reason, stack ? `\ncomponent stack:${stack}` : "");
	} catch {
		// Logging must never change the error path.
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
