import type { ThemeUsageStats } from "@vetta-org/theme-sdk";
import type { CultivationScoreBreakdown } from "./types";

/**
 * Convert app-monitor aggregates into a single cultivation score.
 * Weights are xianxia-owned and independent of settings achievement ladders.
 */
export function computeCultivationScore(stats: ThemeUsageStats): {
	score: number;
	breakdown: CultivationScoreBreakdown;
} {
	const activeMinutes = Math.max(0, stats.foregroundActiveMs) / 60_000;
	const tokenK = Math.max(0, stats.totalTokens) / 1_000;

	const breakdown: CultivationScoreBreakdown = {
		// ~1 pt per active minute
		activeTime: activeMinutes * 1,
		// dialogue volume
		messages: Math.max(0, stats.messages) * 2,
		turns: Math.max(0, stats.turns) * 4,
		// tool / agent work
		tools: Math.max(0, stats.toolsCompleted) * 1.5,
		// starting conversations
		sessions: Math.max(0, stats.interactiveSessions) * 8,
		// model usage scale
		tokens: tokenK * 0.05,
		// habit / return
		streak: Math.max(0, stats.activeDayStreak) * 25,
		// automation product lines
		batch: Math.max(0, stats.batchRuns) * 12,
		automation: Math.max(0, stats.automationRuns) * 12,
		// knowledge base activity
		knowledge:
			Math.max(0, stats.knowledgeBaseCount) * 15 +
			Math.max(0, stats.knowledgeBaseFileOperations) * 3,
		projects: Math.max(0, stats.projectsCreated) * 10,
		// long conversation depth
		depth:
			Math.max(0, stats.longestConversationTurns) * 0.8 +
			Math.max(0, stats.longestConversationMessages) * 0.2,
	};

	const score =
		breakdown.activeTime +
		breakdown.messages +
		breakdown.turns +
		breakdown.tools +
		breakdown.sessions +
		breakdown.tokens +
		breakdown.streak +
		breakdown.batch +
		breakdown.automation +
		breakdown.knowledge +
		breakdown.projects +
		breakdown.depth;

	return {
		score: Math.floor(score * 100) / 100,
		breakdown: {
			activeTime: round2(breakdown.activeTime),
			messages: round2(breakdown.messages),
			turns: round2(breakdown.turns),
			tools: round2(breakdown.tools),
			sessions: round2(breakdown.sessions),
			tokens: round2(breakdown.tokens),
			streak: round2(breakdown.streak),
			batch: round2(breakdown.batch),
			automation: round2(breakdown.automation),
			knowledge: round2(breakdown.knowledge),
			projects: round2(breakdown.projects),
			depth: round2(breakdown.depth),
		},
	};
}

function round2(value: number): number {
	return Math.floor(value * 100) / 100;
}
