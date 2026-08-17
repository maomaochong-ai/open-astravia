import type { ProviderObservationValue } from "./provider-observation-contracts.js";

const REDACTED = "[REDACTED]";
const SECRET_NAME_PATTERN = /(?:authorization|cookie|credential|api[-_]?key|access[-_]?key|token|secret|password)/i;

export interface ProviderObservationSanitizerOptions {
	readonly maxDepth?: number;
	readonly maxEntries?: number;
	readonly maxStringLength?: number;
}

export function sanitizeProviderObservationValue(
	value: unknown,
	options: ProviderObservationSanitizerOptions = {},
): ProviderObservationValue {
	const seen = new WeakSet<object>();
	const limits = {
		maxDepth: options.maxDepth ?? 12,
		maxEntries: options.maxEntries ?? 200,
		maxStringLength: options.maxStringLength ?? 16_384,
	};
	return sanitize(value, undefined, 0, seen, limits);
}

export function sanitizeProviderObservationHeaders(
	headers: ConstructorParameters<typeof Headers>[0] | undefined,
): Record<string, string> {
	if (!headers) return {};
	const result: Record<string, string> = {};
	for (const [name, value] of new Headers(headers)) {
		result[name] = isSecretName(name) ? REDACTED : truncate(value, 2_048);
	}
	return result;
}

export function sanitizeProviderObservationUrl(value: string): string {
	try {
		const url = new URL(value);
		for (const name of url.searchParams.keys()) {
			if (isSecretName(name)) url.searchParams.set(name, REDACTED);
		}
		return url.toString();
	} catch {
		return truncate(value, 4_096);
	}
}

function sanitize(
	value: unknown,
	key: string | undefined,
	depth: number,
	seen: WeakSet<object>,
	limits: Required<ProviderObservationSanitizerOptions>,
): ProviderObservationValue {
	if (key && isSecretName(key)) return REDACTED;
	if (value === null || typeof value === "boolean" || typeof value === "number") return value;
	if (typeof value === "string") return truncate(value, limits.maxStringLength);
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "undefined") return "[undefined]";
	if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
	if (typeof value === "symbol") return value.toString();
	if (depth >= limits.maxDepth) return "[max-depth]";
	if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`;
	if (value instanceof Date) return value.toISOString();
	if (value instanceof Error) return { name: value.name, message: truncate(value.message, limits.maxStringLength) };
	if (typeof value !== "object") return String(value);
	if (seen.has(value)) return "[circular]";
	seen.add(value);

	if (Array.isArray(value)) {
		return value.slice(0, limits.maxEntries).map((item) => sanitize(item, undefined, depth + 1, seen, limits));
	}

	const result: Record<string, ProviderObservationValue> = {};
	for (const [entryKey, entryValue] of Object.entries(value).slice(0, limits.maxEntries)) {
		result[entryKey] = sanitize(entryValue, entryKey, depth + 1, seen, limits);
	}
	return result;
}

function isSecretName(name: string): boolean {
	return SECRET_NAME_PATTERN.test(name);
}

function truncate(value: string, maximum: number): string {
	return value.length <= maximum ? value : `${value.slice(0, maximum)}...[truncated ${value.length - maximum} chars]`;
}
