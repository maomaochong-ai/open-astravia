import type { ThemeUsageModel, ThemeUsageStats, ThemeUsageStatus } from "@vetta/theme-sdk/usage";
import { useCallback, useEffect, useState } from "react";

const EMPTY_STATS: ThemeUsageStats = {
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
};

/**
 * Host implementation of theme-sdk `useThemeUsageStats`.
 * Reads privacy-safe aggregates from app-monitor (same source as settings achievements).
 */
export function useThemeUsageStats(): ThemeUsageModel {
	const [stats, setStats] = useState<ThemeUsageStats | null>(null);
	const [status, setStatus] = useState<ThemeUsageStatus>("loading");

	const refresh = useCallback(async (): Promise<void> => {
		try {
			const next = await window.vetta.appMonitor.getAchievementUsage();
			setStats(next);
			setStatus("ready");
		} catch (error) {
			console.warn(
				`[theme-usage] failed to load achievement usage: ${error instanceof Error ? error.message : String(error)}`,
			);
			setStats((prev) => prev ?? EMPTY_STATS);
			setStatus("error");
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	return {
		refresh,
		stats,
		status,
	};
}
