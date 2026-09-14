import type { ThemeStorageValue } from "@vetta-org/theme-sdk";
import { z } from "zod";
import type { CultivationHistory, CultivationSnapshot } from "../types";

export const CULTIVATION_STORAGE_KEY = "cultivation";
export const CULTIVATION_HISTORY_STORAGE_KEY = "cultivation-history";
export const CULTIVATION_SNAPSHOT_STORAGE_VERSION = 3;
export const CULTIVATION_HISTORY_STORAGE_VERSION = 1;

const num = (fallback = 0) => z.number().finite().catch(fallback);

const scoreBreakdownSchema = z.object({
	activeTime: num(),
	messages: num(),
	turns: num(),
	tools: num(),
	sessions: num(),
	tokens: num(),
	streak: num(),
	batch: num(),
	automation: num(),
	knowledge: num(),
	projects: num(),
	depth: num(),
});

const growthSchema = z.object({
	today: num(),
	thisWeek: num(),
	last30Days: num(),
});

export const dailyScoreSchema = z.object({
	date: z.string(),
	score: z.number().finite(),
});

export const dailyMetricsSchema = z.object({
	date: z.string(),
	automationRuns: num(),
	batchRuns: num(),
	interactiveSessions: num(),
	knowledgeBaseCount: num(),
	knowledgeBaseFileOperations: num(),
	messages: num(),
	projectsCreated: num(),
	toolsCompleted: num(),
});

const metricsSchema = z.object({
	activeDayStreak: num(),
	automationRuns: num(),
	batchRuns: num(),
	foregroundActiveMs: num(),
	interactiveSessions: num(),
	knowledgeBaseCount: num(),
	knowledgeBaseFileOperations: num(),
	longestConversationMessages: num(),
	longestConversationTurns: num(),
	messages: num(),
	projectsCreated: num(),
	todayActiveMs: num(),
	todayMessages: num(),
	toolsCompleted: num(),
	totalTokens: num(),
	turns: num(),
});

const cultivationSnapshotSchema = z.object({
	schemaVersion: z.literal(CULTIVATION_SNAPSHOT_STORAGE_VERSION),
	updatedAt: num(Date.now()),
	realmId: z.string(),
	level: z.number().finite(),
	name: z.string(),
	englishName: z.string(),
	score: num(),
	realmStartScore: num(),
	cultivationPower: z.number().finite(),
	cultivationPowerTarget: z.number().finite(),
	scoreBreakdown: scoreBreakdownSchema.catch({
		activeTime: 0,
		messages: 0,
		turns: 0,
		tools: 0,
		sessions: 0,
		tokens: 0,
		streak: 0,
		batch: 0,
		automation: 0,
		knowledge: 0,
		projects: 0,
		depth: 0,
	}),
	growth: growthSchema,
	progressToNext: z.number().finite(),
	nextRealmId: z.string().nullable().catch(null),
	nextRealmTargetScore: z.number().finite().nullable().catch(null),
	achievedRealmIds: z.array(z.string()),
	metrics: metricsSchema.catch({
		activeDayStreak: 0,
		automationRuns: 0,
		batchRuns: 0,
		foregroundActiveMs: 0,
		interactiveSessions: 0,
		knowledgeBaseCount: 0,
		knowledgeBaseFileOperations: 0,
		longestConversationMessages: 0,
		longestConversationTurns: 0,
		messages: 0,
		projectsCreated: 0,
		todayActiveMs: 0,
		todayMessages: 0,
		toolsCompleted: 0,
		totalTokens: 0,
		turns: 0,
	}),
});

const cultivationHistorySchema = z.object({
	schemaVersion: z.literal(CULTIVATION_HISTORY_STORAGE_VERSION),
	updatedAt: num(),
	dailyScores: z.array(dailyScoreSchema).catch([]),
	dailyMetrics: z.array(dailyMetricsSchema).catch([]),
});

export function parseCultivationSnapshot(value: unknown): CultivationSnapshot | null {
	const parsed = cultivationSnapshotSchema.safeParse(value);
	if (!parsed.success) return null;
	const data = parsed.data;
	return {
		updatedAt: data.updatedAt,
		realmId: data.realmId,
		level: data.level,
		name: data.name,
		englishName: data.englishName,
		score: data.score,
		realmStartScore: data.realmStartScore,
		cultivationPower: data.cultivationPower,
		cultivationPowerTarget: data.cultivationPowerTarget,
		scoreBreakdown: data.scoreBreakdown,
		growth: data.growth,
		progressToNext: data.progressToNext,
		nextRealmId: data.nextRealmId,
		nextRealmTargetScore: data.nextRealmTargetScore,
		achievedRealmIds: data.achievedRealmIds,
		metrics: data.metrics,
	};
}

export function parseCultivationHistory(value: unknown): CultivationHistory | null {
	const parsed = cultivationHistorySchema.safeParse(value);
	if (!parsed.success) return null;
	return {
		dailyScores: parsed.data.dailyScores,
		dailyMetrics: parsed.data.dailyMetrics,
	};
}

export function toCultivationSnapshotStorageValue(snapshot: CultivationSnapshot): ThemeStorageValue {
	return {
		schemaVersion: CULTIVATION_SNAPSHOT_STORAGE_VERSION,
		updatedAt: snapshot.updatedAt,
		realmId: snapshot.realmId,
		level: snapshot.level,
		name: snapshot.name,
		englishName: snapshot.englishName,
		score: snapshot.score,
		realmStartScore: snapshot.realmStartScore,
		cultivationPower: snapshot.cultivationPower,
		cultivationPowerTarget: snapshot.cultivationPowerTarget,
		scoreBreakdown: { ...snapshot.scoreBreakdown },
		growth: { ...snapshot.growth },
		progressToNext: snapshot.progressToNext,
		nextRealmId: snapshot.nextRealmId,
		nextRealmTargetScore: snapshot.nextRealmTargetScore,
		achievedRealmIds: [...snapshot.achievedRealmIds],
		metrics: { ...snapshot.metrics },
	};
}

export function toCultivationHistoryStorageValue(
	history: CultivationHistory,
	updatedAt: number,
): ThemeStorageValue {
	return {
		schemaVersion: CULTIVATION_HISTORY_STORAGE_VERSION,
		updatedAt,
		dailyScores: history.dailyScores.map((entry) => ({ ...entry })),
		dailyMetrics: history.dailyMetrics.map((entry) => ({ ...entry })),
	};
}
