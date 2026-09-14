import type { ThemeUsageStats } from "@vetta-org/theme-sdk";
import {
	createEmptyCultivationHistory,
	finalizeCultivationHistory,
	getCultivationDailyScores,
} from "./cultivation-history";
import { CULTIVATION_REALMS } from "./realms";
import { computeCultivationScore } from "./score";
import {
	type CultivationDailyScore,
	type CultivationGrowth,
	type CultivationSnapshot,
	type CultivationState,
} from "./types";

const MS_PER_DAY = 86_400_000;

function clamp01(value: number): number {
	if (value <= 0) return 0;
	if (value >= 1) return 1;
	return value;
}

function getLocalDateKey(timestamp: number): string {
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function getDateKeyDaysAgo(timestamp: number, days: number): string {
	return getLocalDateKey(timestamp - days * MS_PER_DAY);
}

function findScoreAtOrBefore(dailyScores: readonly CultivationDailyScore[], date: string): number | null {
	for (let index = dailyScores.length - 1; index >= 0; index--) {
		const entry = dailyScores[index];
		if (entry.date <= date) return entry.score;
	}
	return null;
}

/** Latest score strictly before `date` (excludes same-day sample). */
function findScoreBefore(dailyScores: readonly CultivationDailyScore[], date: string): number | null {
	for (let index = dailyScores.length - 1; index >= 0; index--) {
		const entry = dailyScores[index];
		if (entry.date < date) return entry.score;
	}
	return null;
}

/**
 * Growth deltas vs historical baselines.
 * - today: current score − last score strictly before today
 *   (must NOT use today's dailyScores entry — it is refreshed to current score every sync)
 * - week / 30d: current score − sample on/before the window start day
 *   (do NOT fall back to today's baseline — that collapses week/month into "today")
 *
 * If history is shorter than the window (no sample on/before start), baseline is 0:
 * the value may equal "today" only when there is no prior-day sample at all.
 */
function computeGrowth(score: number, dailyScores: readonly CultivationDailyScore[], now: number): CultivationGrowth {
	const today = getLocalDateKey(now);
	const weekStart = getDateKeyDaysAgo(now, 7);
	const monthStart = getDateKeyDaysAgo(now, 30);
	const todayBase = findScoreBefore(dailyScores, today);
	const weekBase = findScoreAtOrBefore(dailyScores, weekStart);
	const monthBase = findScoreAtOrBefore(dailyScores, monthStart);

	return {
		today: round2(Math.max(0, score - (todayBase ?? 0))),
		thisWeek: round2(Math.max(0, score - (weekBase ?? 0))),
		last30Days: round2(Math.max(0, score - (monthBase ?? 0))),
	};
}

/**
 * Map app-monitor usage aggregates → xianxia cultivation snapshot.
 * Score is multi-metric; realm gates use theme-owned targetScore thresholds.
 */
export function computeCultivation(
	stats: ThemeUsageStats,
	now = Date.now(),
	previous?: CultivationState | null,
): CultivationState {
	const { score, breakdown } = computeCultivationScore(stats);
	const history = finalizeCultivationHistory(
		previous?.history ?? createEmptyCultivationHistory(),
		previous?.snapshot,
		now,
	);
	const dailyScores = getCultivationDailyScores(history, { score, updatedAt: now });

	let currentIndex = 0;
	for (let i = 0; i < CULTIVATION_REALMS.length; i++) {
		if (score >= CULTIVATION_REALMS[i].targetScore) {
			currentIndex = i;
		} else {
			break;
		}
	}

	const current = CULTIVATION_REALMS[currentIndex];
	const next = CULTIVATION_REALMS[currentIndex + 1] ?? null;
	const achievedRealmIds = CULTIVATION_REALMS.slice(0, currentIndex + 1).map((realm) => realm.id);
	const realmSpan = next ? next.targetScore - current.targetScore : 0;
	const cultivationPower = round2(Math.max(0, score - current.targetScore));
	const cultivationPowerTarget = round2(Math.max(0, realmSpan));

	let progressToNext = 1;
	if (next) {
		progressToNext = realmSpan <= 0 ? 1 : clamp01(cultivationPower / realmSpan);
	}

	const snapshot: CultivationSnapshot = {
		updatedAt: now,
		realmId: current.id,
		level: current.level,
		name: current.name,
		englishName: current.englishName,
		score,
		realmStartScore: current.targetScore,
		cultivationPower,
		cultivationPowerTarget,
		scoreBreakdown: breakdown,
		growth: computeGrowth(score, dailyScores, now),
		progressToNext,
		nextRealmId: next?.id ?? null,
		nextRealmTargetScore: next?.targetScore ?? null,
		achievedRealmIds,
		metrics: {
			activeDayStreak: stats.activeDayStreak,
			automationRuns: stats.automationRuns,
			batchRuns: stats.batchRuns,
			foregroundActiveMs: stats.foregroundActiveMs,
			interactiveSessions: stats.interactiveSessions,
			knowledgeBaseCount: stats.knowledgeBaseCount,
			knowledgeBaseFileOperations: stats.knowledgeBaseFileOperations,
			longestConversationMessages: stats.longestConversationMessages,
			longestConversationTurns: stats.longestConversationTurns,
			messages: stats.messages,
			projectsCreated: stats.projectsCreated,
			todayActiveMs: stats.todayActiveMs,
			todayMessages: stats.todayMessages,
			toolsCompleted: stats.toolsCompleted,
			totalTokens: stats.totalTokens,
			turns: stats.turns,
		},
	};
	return { snapshot, history };
}

/** Compare cultivation payloads ignoring volatile `updatedAt`. */
export function isSameCultivationSnapshot(
	left: CultivationSnapshot | null | undefined,
	right: CultivationSnapshot,
): boolean {
	if (!left) return false;
	const { updatedAt: _leftUpdatedAt, ...leftStable } = left;
	const { updatedAt: _rightUpdatedAt, ...rightStable } = right;
	return JSON.stringify(leftStable) === JSON.stringify(rightStable);
}

function round2(value: number): number {
	return Math.floor(value * 100) / 100;
}
