import { migrateVersionedConfig } from "@astravia/toolkit/versioned-config";
import { z } from "zod";
import {
	CULTIVATION_HISTORY_RETENTION_DAYS,
	createEmptyCultivationHistory,
	getLocalDateKey,
	isSameCultivationHistory,
} from "../../cultivation-history";
import type {
	CultivationDailyMetrics,
	CultivationDailyScore,
	CultivationHistory,
	CultivationState,
} from "../../types";
import {
	CULTIVATION_SNAPSHOT_STORAGE_VERSION,
	dailyMetricsSchema,
	dailyScoreSchema,
	parseCultivationHistory,
	parseCultivationSnapshot,
} from "../cultivation-storage.schema";
import { cultivationMigration001To2 } from "./001_to_2";
import { cultivationMigration002To3 } from "./002_to_3";

const CULTIVATION_MIGRATIONS = [cultivationMigration001To2, cultivationMigration002To3] as const;

const legacyVersionPrepSchema = z.record(z.string(), z.unknown()).transform((record) => {
	if (typeof record.schemaVersion === "number") return record;
	if (typeof record.version === "number") return { ...record, schemaVersion: record.version };
	return record;
});

const legacyHistorySchema = z.object({
	dailyScores: z.array(dailyScoreSchema).catch([]),
	dailyMetrics: z.array(dailyMetricsSchema).catch([]),
});

export interface CultivationStorageReadResult {
	readonly rewriteHistory: boolean;
	readonly rewriteSnapshot: boolean;
	readonly state: CultivationState | null;
}

function prepareLegacyVersionField(value: unknown): unknown {
	const parsed = legacyVersionPrepSchema.safeParse(value);
	return parsed.success ? parsed.data : value;
}

function mergeDailyScores(
	legacy: readonly CultivationDailyScore[],
	current: readonly CultivationDailyScore[],
	currentDate: string,
): readonly CultivationDailyScore[] {
	const byDate = new Map<string, number>();
	for (const entry of legacy) {
		if (entry.date < currentDate) byDate.set(entry.date, entry.score);
	}
	for (const entry of current) byDate.set(entry.date, entry.score);
	return [...byDate.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.slice(-CULTIVATION_HISTORY_RETENTION_DAYS)
		.map(([date, score]) => ({ date, score }));
}

function mergeDailyMetrics(
	legacy: readonly CultivationDailyMetrics[],
	current: readonly CultivationDailyMetrics[],
	currentDate: string,
): readonly CultivationDailyMetrics[] {
	const byDate = new Map<string, CultivationDailyMetrics>();
	for (const entry of legacy) {
		if (entry.date < currentDate) byDate.set(entry.date, entry);
	}
	for (const entry of current) byDate.set(entry.date, entry);
	return [...byDate.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.slice(-CULTIVATION_HISTORY_RETENTION_DAYS)
		.map(([, entry]) => entry);
}

/** Decode all supported storage layouts into the one canonical domain model. */
export function readCultivationStorage(
	snapshotValue: unknown,
	historyValue: unknown,
): CultivationStorageReadResult {
	const parsedHistory = parseCultivationHistory(historyValue);
	const currentHistory = parsedHistory ?? createEmptyCultivationHistory();
	const historyInvalid = historyValue !== undefined && parsedHistory === null;
	if (snapshotValue === null || snapshotValue === undefined) {
		return { rewriteHistory: historyInvalid, rewriteSnapshot: false, state: null };
	}

	const recordParse = z.record(z.string(), z.unknown()).safeParse(snapshotValue);
	if (!recordParse.success) {
		return { rewriteHistory: historyInvalid, rewriteSnapshot: false, state: null };
	}
	const record = recordParse.data;
	const hasEmbeddedHistory = Array.isArray(record.dailyScores) || Array.isArray(record.dailyMetrics);
	const legacyRemapped = typeof record.schemaVersion !== "number" && typeof record.version === "number";
	const redundantLegacyVersion = typeof record.schemaVersion === "number" && "version" in record;

	try {
		const migratedResult = migrateVersionedConfig(prepareLegacyVersionField(record), {
			currentVersion: CULTIVATION_SNAPSHOT_STORAGE_VERSION,
			initialVersion: 1,
			migrations: CULTIVATION_MIGRATIONS,
		});
		const snapshot = parseCultivationSnapshot(migratedResult.config);
		if (!snapshot) {
			return { rewriteHistory: historyInvalid, rewriteSnapshot: false, state: null };
		}

		const legacyHistory = legacyHistorySchema.parse(migratedResult.config);
		const currentDate = getLocalDateKey(snapshot.updatedAt);
		const history: CultivationHistory = {
			dailyScores: mergeDailyScores(legacyHistory.dailyScores, currentHistory.dailyScores, currentDate),
			dailyMetrics: mergeDailyMetrics(legacyHistory.dailyMetrics, currentHistory.dailyMetrics, currentDate),
		};

		return {
			rewriteHistory: historyInvalid || !isSameCultivationHistory(currentHistory, history),
			rewriteSnapshot:
				migratedResult.migrated || legacyRemapped || redundantLegacyVersion || hasEmbeddedHistory,
			state: { snapshot, history },
		};
	} catch {
		return { rewriteHistory: historyInvalid, rewriteSnapshot: false, state: null };
	}
}
