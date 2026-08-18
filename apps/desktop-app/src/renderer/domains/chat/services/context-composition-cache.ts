import type { ContextCompositionReport } from "@vetta/runtime-core";

const STORAGE_KEY = "vetta-context-composition-cache-v1";
const MAX_ENTRIES = 10;

const SECTION_KINDS = new Set(["instruction", "tool_schema", "history", "runtime_context", "user_input"]);
const SOURCE_OWNERS = new Set(["core", "skill", "plugin", "mcp", "extension", "runtime", "user", "unknown"]);
const ESTIMATE_METHODS = new Set(["provider_tokenizer", "model_tokenizer", "heuristic", "unknown"]);
const COVERAGE_VALUES = new Set(["complete", "partial", "none"]);

export interface ContextCompositionStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

interface CachedContextComposition {
	readonly sessionPath: string;
	readonly report: ContextCompositionReport;
}

interface ContextCompositionCacheEnvelope {
	readonly version: 1;
	readonly entries: readonly CachedContextComposition[];
}

export function readCachedContextComposition(
	sessionPath: string,
	storage: ContextCompositionStorage | null = browserStorage(),
): ContextCompositionReport | undefined {
	if (!sessionPath || !storage) return undefined;
	return readEnvelope(storage).entries.find((entry) => entry.sessionPath === sessionPath)?.report;
}

export function resolveSessionContextComposition(
	sessionPath: string,
	currentReport: ContextCompositionReport | undefined,
	storage: ContextCompositionStorage | null = browserStorage(),
): ContextCompositionReport | undefined {
	if (currentReport) {
		writeCachedContextComposition(sessionPath, currentReport, storage);
		return currentReport;
	}
	return readCachedContextComposition(sessionPath, storage);
}

export function writeCachedContextComposition(
	sessionPath: string,
	report: ContextCompositionReport,
	storage: ContextCompositionStorage | null = browserStorage(),
): void {
	if (!sessionPath || !storage) return;
	const entries = [
		{ sessionPath, report },
		...readEnvelope(storage).entries.filter((entry) => entry.sessionPath !== sessionPath),
	].slice(0, MAX_ENTRIES);
	try {
		storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries } satisfies ContextCompositionCacheEnvelope));
	} catch {
		// localStorage quota/private-mode failures only disable restart restoration.
	}
}

function browserStorage(): ContextCompositionStorage | null {
	return typeof localStorage === "undefined" ? null : localStorage;
}

function readEnvelope(storage: ContextCompositionStorage): ContextCompositionCacheEnvelope {
	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (!raw) return emptyEnvelope();
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
			storage.removeItem(STORAGE_KEY);
			return emptyEnvelope();
		}
		const entries = parsed.entries.flatMap((entry) => {
			if (!isRecord(entry) || typeof entry.sessionPath !== "string" || !isContextCompositionReport(entry.report)) {
				return [];
			}
			return [{ sessionPath: entry.sessionPath, report: entry.report }];
		});
		return { version: 1, entries: entries.slice(0, MAX_ENTRIES) };
	} catch {
		try {
			storage.removeItem(STORAGE_KEY);
		} catch {
			// Ignore unavailable storage; callers fall back to the empty cache.
		}
		return emptyEnvelope();
	}
}

function emptyEnvelope(): ContextCompositionCacheEnvelope {
	return { version: 1, entries: [] };
}

function isContextCompositionReport(value: unknown): value is ContextCompositionReport {
	if (!isRecord(value) || value.version !== 1) return false;
	if (typeof value.callId !== "string" || typeof value.snapshotId !== "string") return false;
	if ((value.phase !== "prepared" && value.phase !== "completed") || !isFiniteNumber(value.createdAt)) return false;
	if (!isModel(value.model) || !isEstimate(value.estimate) || !Array.isArray(value.sections)) return false;
	if (!isOptionalNullableNumber(value.providerReportedInputTokens)) return false;
	return value.sections.every(isSection);
}

function isModel(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.provider === "string" &&
		typeof value.modelId === "string" &&
		isFiniteNumber(value.contextWindow)
	);
}

function isEstimate(value: unknown): boolean {
	return (
		isRecord(value) &&
		isNullableNumber(value.tokens) &&
		isFiniteNumber(value.knownTokens) &&
		typeof value.coverage === "string" &&
		COVERAGE_VALUES.has(value.coverage)
	);
}

function isSection(value: unknown): boolean {
	if (!isRecord(value) || typeof value.id !== "string") return false;
	if (typeof value.kind !== "string" || !SECTION_KINDS.has(value.kind)) return false;
	if (value.category !== undefined && typeof value.category !== "string") return false;
	if (!isRecord(value.source) || typeof value.source.owner !== "string" || !SOURCE_OWNERS.has(value.source.owner)) {
		return false;
	}
	if (typeof value.source.id !== "string" || !isNullableNumber(value.estimatedTokens)) return false;
	if (typeof value.estimateMethod !== "string" || !ESTIMATE_METHODS.has(value.estimateMethod)) return false;
	if (value.tokenizerId !== undefined && typeof value.tokenizerId !== "string") return false;
	if (value.characters !== undefined && !isFiniteNumber(value.characters)) return false;
	return isNullableNumber(value.percentOfWindow);
}

function isOptionalNullableNumber(value: unknown): boolean {
	return value === undefined || isNullableNumber(value);
}

function isNullableNumber(value: unknown): boolean {
	return value === null || isFiniteNumber(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
