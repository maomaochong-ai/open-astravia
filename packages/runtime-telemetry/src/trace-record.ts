import type { RuntimeObservationContext } from "@vetta/runtime-core/observation";

export type RuntimeTraceState = "running" | "completed" | "error" | "interrupted";
export type RuntimeTraceMetadata = Readonly<Record<string, string | number | boolean>>;
export interface RuntimeTraceRecord {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly traceId: string;
	readonly parentSpanId?: string;
	readonly kind: "agent" | "generation" | "tool" | "span" | "event";
	readonly name: string;
	readonly startedAt: number;
	readonly endedAt?: number;
	readonly state: RuntimeTraceState;
	readonly context: RuntimeObservationContext;
	readonly metadata: RuntimeTraceMetadata;
	readonly usage: Readonly<Record<string, number>>;
	readonly cost: Readonly<Record<string, number>>;
}

const IDENTITY_KEYS = [
	"agentId",
	"revisionId",
	"instanceId",
	"sessionId",
	"turnId",
	"modelCallId",
	"toolCallId",
	"traceId",
] as const;
const STRING_KEYS = new Set([
	"phase",
	"operation",
	"status",
	"code",
	"provider",
	"api",
	"model",
	"toolName",
	"stopReason",
	"spanId",
	"localTraceId",
	"localSpanId",
]);
const NUMBER_KEYS = new Set([
	"revision",
	"configurationRevision",
	"durationMs",
	"messageCount",
	"initialMessageCount",
	"toolCount",
	"modelCalls",
	"toolCalls",
	"recoveryAttempts",
	"phaseCount",
	"count",
]);
const BOOLEAN_KEYS = new Set(["isError"]);
const USAGE_KEYS = ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "total"] as const;

export function traceIdentifier(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[\w.:/@+-]+$/.test(value)
		? value
		: undefined;
}
export function traceObject(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
export function safeTraceContext(value: unknown): RuntimeObservationContext {
	const source = traceObject(value);
	const result: Record<string, string> = {};
	for (const key of IDENTITY_KEYS) {
		const id = traceIdentifier(source?.[key]);
		if (id) result[key] = id;
	}
	return result;
}
export function safeTraceMetadata(value: unknown): RuntimeTraceMetadata {
	const source = traceObject(value);
	const result: Record<string, string | number | boolean> = {};
	for (const [key, item] of Object.entries(source ?? {})) {
		if (STRING_KEYS.has(key)) {
			const text = traceIdentifier(item);
			if (text) result[key] = text;
		}
		if (NUMBER_KEYS.has(key) && typeof item === "number" && Number.isFinite(item) && item >= 0) result[key] = item;
		if (BOOLEAN_KEYS.has(key) && typeof item === "boolean") result[key] = item;
	}
	const failure = traceObject(source?.failure);
	const code = traceIdentifier(failure?.code ?? failure?.errorCode);
	if (code && result.code === undefined) result.code = code;
	return result;
}
export function safeTraceNumbers(value: unknown): Readonly<Record<string, number>> {
	const source = traceObject(value);
	const result: Record<string, number> = {};
	for (const key of USAGE_KEYS) {
		const item = source?.[key];
		if (typeof item === "number" && Number.isFinite(item) && item >= 0) result[key] = item;
	}
	return result;
}

/** Revalidates disk/IPC data and drops all fields outside the diagnostic contract. */
export function parseRuntimeTraceRecord(value: unknown): RuntimeTraceRecord | undefined {
	const item = traceObject(value);
	if (!item || item.schemaVersion !== 1) return undefined;
	const id = traceIdentifier(item.id),
		traceId = traceIdentifier(item.traceId),
		name = traceIdentifier(item.name);
	if (
		!id ||
		!traceId ||
		!name ||
		typeof item.startedAt !== "number" ||
		!Number.isFinite(item.startedAt) ||
		item.startedAt < 0
	)
		return undefined;
	if (
		item.endedAt !== undefined &&
		(typeof item.endedAt !== "number" || !Number.isFinite(item.endedAt) || item.endedAt < item.startedAt)
	)
		return undefined;
	if (
		item.kind !== "agent" &&
		item.kind !== "generation" &&
		item.kind !== "tool" &&
		item.kind !== "span" &&
		item.kind !== "event"
	)
		return undefined;
	if (item.state !== "running" && item.state !== "completed" && item.state !== "error" && item.state !== "interrupted")
		return undefined;
	return {
		schemaVersion: 1,
		id,
		traceId,
		name,
		kind: item.kind,
		startedAt: item.startedAt,
		...(typeof item.endedAt === "number" ? { endedAt: item.endedAt } : {}),
		...(traceIdentifier(item.parentSpanId) ? { parentSpanId: traceIdentifier(item.parentSpanId) } : {}),
		state: item.state,
		context: safeTraceContext(item.context),
		metadata: safeTraceMetadata(item.metadata),
		usage: safeTraceNumbers(item.usage),
		cost: safeTraceNumbers(item.cost),
	};
}
