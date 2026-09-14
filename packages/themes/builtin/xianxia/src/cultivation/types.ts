import type { ThemeUsageStats } from "@vetta-org/theme-sdk";

export interface CultivationRealmDefinition {
	readonly id: string;
	readonly level: number;
	readonly name: string;
	readonly englishName: string;
	/** Minimum cultivation score (from app-monitor) to enter this realm. */
	readonly targetScore: number;
}

/** Point breakdown derived from app-monitor aggregates. */
export interface CultivationScoreBreakdown {
	readonly activeTime: number;
	readonly messages: number;
	readonly turns: number;
	readonly tools: number;
	readonly sessions: number;
	readonly tokens: number;
	readonly streak: number;
	readonly batch: number;
	readonly automation: number;
	readonly knowledge: number;
	readonly projects: number;
	readonly depth: number;
}

export interface CultivationGrowth {
	readonly today: number;
	readonly thisWeek: number;
	readonly last30Days: number;
}

export interface CultivationDailyScore {
	readonly date: string;
	readonly score: number;
}

/**
 * End-of-day (last sync that day) cumulative host metrics.
 * Theme owns this history; host only supplies the latest totals.
 * Period deltas = sample(end) − sample(before period start).
 */
export interface CultivationDailyMetrics {
	readonly date: string;
	readonly automationRuns: number;
	readonly batchRuns: number;
	readonly interactiveSessions: number;
	readonly knowledgeBaseCount: number;
	readonly knowledgeBaseFileOperations: number;
	readonly messages: number;
	readonly projectsCreated: number;
	readonly toolsCompleted: number;
}

/** Closed-day samples persisted separately from the frequently updated snapshot. */
export interface CultivationHistory {
	readonly dailyScores: readonly CultivationDailyScore[];
	readonly dailyMetrics: readonly CultivationDailyMetrics[];
}

/**
 * Current cultivation snapshot derived from app-monitor aggregates.
 * Never stores raw user content.
 */
export interface CultivationSnapshot {
	readonly updatedAt: number;
	readonly realmId: string;
	readonly level: number;
	readonly name: string;
	readonly englishName: string;
	/** Total cultivation score from app-monitor. */
	readonly score: number;
	/** Current realm's entry score. */
	readonly realmStartScore: number;
	/** Current progress inside the active realm. */
	readonly cultivationPower: number;
	/** Required progress inside the active realm; equals 0 at max realm. */
	readonly cultivationPowerTarget: number;
	readonly scoreBreakdown: CultivationScoreBreakdown;
	readonly growth: CultivationGrowth;
	/** 0..1 progress toward the next realm; 1 when max realm. */
	readonly progressToNext: number;
	readonly nextRealmId: string | null;
	readonly nextRealmTargetScore: number | null;
	readonly achievedRealmIds: readonly string[];
	/** Raw app-monitor snapshot used for this computation. */
	readonly metrics: ThemeUsageStats;
}

/** Canonical cultivation model consumed by business logic and views. */
export interface CultivationState {
	readonly snapshot: CultivationSnapshot;
	readonly history: CultivationHistory;
}
