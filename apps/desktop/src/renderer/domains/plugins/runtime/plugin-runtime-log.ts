import { redactSensitiveText } from "../../../../shared/sentry-privacy";

type PluginRuntimeLogValue = boolean | number | string | readonly string[] | null | undefined;

const MAX_ERROR_TEXT_LENGTH = 16_384;

export interface PluginRuntimeLogFields {
	readonly pluginId?: string;
	readonly pluginVersion?: string;
	readonly pluginSource?: string;
	readonly activationId?: string;
	readonly capabilitySessionId?: string;
	readonly stage?: string;
	readonly reason?: string;
	readonly count?: number;
	readonly pluginIds?: readonly string[];
	readonly [key: string]: PluginRuntimeLogValue;
}

interface SafePluginRuntimeError {
	readonly name: string;
	readonly message: string;
	readonly stack?: string;
	readonly cause?: SafePluginRuntimeError;
}

function redactAndTruncate(value: string): string {
	const redacted = redactSensitiveText(value);
	return redacted.length <= MAX_ERROR_TEXT_LENGTH
		? redacted
		: `${redacted.slice(0, MAX_ERROR_TEXT_LENGTH)}…[truncated]`;
}

function safeError(error: unknown, depth = 0): SafePluginRuntimeError {
	if (!(error instanceof Error)) {
		return { name: "NonError", message: redactAndTruncate(String(error)) };
	}
	return {
		name: redactAndTruncate(error.name),
		message: redactAndTruncate(error.message),
		...(error.stack ? { stack: redactAndTruncate(error.stack) } : {}),
		...(depth < 2 && error.cause !== undefined ? { cause: safeError(error.cause, depth + 1) } : {}),
	};
}

export function formatPluginRuntimeLog(event: string, fields: PluginRuntimeLogFields, error?: unknown): string {
	return `[plugin-runtime] ${event} ${JSON.stringify({
		...fields,
		...(error === undefined ? {} : { error: safeError(error) }),
	})}`;
}

export function logPluginRuntimeInfo(event: string, fields: PluginRuntimeLogFields): void {
	console.info(formatPluginRuntimeLog(event, fields));
}

export function logPluginRuntimeWarn(event: string, fields: PluginRuntimeLogFields, error?: unknown): void {
	console.warn(formatPluginRuntimeLog(event, fields, error));
}

export function logPluginRuntimeError(event: string, fields: PluginRuntimeLogFields, error: unknown): void {
	console.error(formatPluginRuntimeLog(event, fields, error));
}
