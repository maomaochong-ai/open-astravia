import { __setPluginLogSink, type PluginLogEntry } from "@vetta-org/plugin-sdk";
import { redactSensitiveText } from "../../../../shared/sentry-privacy.js";

const MAX_MESSAGE_LENGTH = 4_096;
const MAX_SERIALIZED_FIELDS_LENGTH = 16_384;
const MAX_DEPTH = 5;
const MAX_COLLECTION_ITEMS = 50;
const SENSITIVE_FIELD_PATTERN = /(?:authorization|cookie|credential|password|secret|token|api[-_]?key)/iu;

function truncate(value: string, limit: number): string {
	return value.length <= limit ? value : `${value.slice(0, limit)}…[truncated]`;
}

function normalizeLogValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
	if (typeof value === "string") return redactSensitiveText(value);
	if (value === null || typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "bigint") return value.toString();
	if (value === undefined) return "[undefined]";
	if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
	if (typeof value === "symbol") return value.toString();
	if (depth >= MAX_DEPTH) return "[max-depth]";
	if (typeof value !== "object") return String(value);
	if (seen.has(value)) return "[circular]";
	seen.add(value);
	if (value instanceof Error) {
		return {
			name: value.name,
			message: redactSensitiveText(value.message),
			...(value.stack ? { stack: redactSensitiveText(value.stack) } : {}),
			...(value.cause === undefined ? {} : { cause: normalizeLogValue(value.cause, depth + 1, seen) }),
		};
	}
	if (Array.isArray(value)) {
		return value.slice(0, MAX_COLLECTION_ITEMS).map((item) => normalizeLogValue(item, depth + 1, seen));
	}
	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value).slice(0, MAX_COLLECTION_ITEMS)) {
		result[key] = SENSITIVE_FIELD_PATTERN.test(key) ? "[redacted]" : normalizeLogValue(item, depth + 1, seen);
	}
	return result;
}

function serializeFields(fields: PluginLogEntry["fields"]): string | undefined {
	if (!fields || Object.keys(fields).length === 0) return undefined;
	try {
		const normalized = normalizeLogValue(fields, 0, new WeakSet());
		return truncate(JSON.stringify(normalized), MAX_SERIALIZED_FIELDS_LENGTH);
	} catch {
		return "[unserializable fields]";
	}
}

export function formatPluginLogEntry(entry: PluginLogEntry): string {
	const prefix = `[plugin:${entry.plugin.id}@${entry.plugin.version}]${entry.scope ? `[${entry.scope}]` : ""}`;
	const message = truncate(redactSensitiveText(entry.message), MAX_MESSAGE_LENGTH);
	const fields = serializeFields(entry.fields);
	return `${prefix} ${message}${fields ? ` ${fields}` : ""}`;
}

export function installPluginLogSink(): void {
	__setPluginLogSink((entry) => {
		const message = formatPluginLogEntry(entry);
		if (entry.level === "error") console.error(message);
		else if (entry.level === "warn") console.warn(message);
		else if (entry.level === "debug") console.debug(message);
		else console.info(message);
	});
}
