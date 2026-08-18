import type { AchievementUsageStats } from "@preload/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { detectAchievementPromotion } from "../achievement-promotion-storage";
import { ACHIEVEMENT_SETS, type Achievement, DEFAULT_ACHIEVEMENT_SET_ID, getAchievementSetById } from "../achievements";

const EMPTY_USAGE_STATS: AchievementUsageStats = {
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

export interface AchievementSetOption {
	readonly id: string;
	readonly label: string;
}

export interface AchievementSettingsModel {
	readonly achievements: readonly Achievement[];
	readonly currentIndex: number;
	readonly focusSizeEnabled: boolean;
	readonly labels: {
		readonly setSelector: string;
	};
	readonly onPromotionComplete: () => void;
	readonly onSelectSetId: (nextSetId: string) => void;
	readonly promotedAchievement: Achievement | null;
	readonly selectedSetId: string;
	readonly setOptions: readonly AchievementSetOption[];
	readonly subtitleKey: string;
	readonly usageStats: AchievementUsageStats;
}

export function useAchievementSettingsModel(): AchievementSettingsModel {
	const { t } = useTranslation("settings");
	const [usageStats, setUsageStats] = useState<AchievementUsageStats>(EMPTY_USAGE_STATS);
	const [usageStatsLoaded, setUsageStatsLoaded] = useState(false);
	const [selectedSetId, setSelectedSetId] = useState(DEFAULT_ACHIEVEMENT_SET_ID);
	const [promotedAchievement, setPromotedAchievement] = useState<Achievement | null>(null);
	const promotionCheckedSetIdsRef = useRef(new Set<string>());
	const selectedSet = getAchievementSetById(selectedSetId);
	const achievements = selectedSet.achievements;

	useEffect(() => {
		void window.vetta.appMonitor
			.getAchievementUsage()
			.then((stats) => {
				setUsageStats(stats);
				setUsageStatsLoaded(true);
			})
			.catch(() => undefined);
	}, []);

	const currentIndex = achievements.reduce(
		(highestIndex, achievement, index) =>
			usageStats.foregroundActiveMs >= achievement.targetActiveMs ? index : highestIndex,
		0,
	);

	useEffect(() => {
		if (!usageStatsLoaded || promotionCheckedSetIdsRef.current.has(selectedSet.id)) return;
		promotionCheckedSetIdsRef.current.add(selectedSet.id);
		const promotedId = detectAchievementPromotion(selectedSet.id, achievements, currentIndex);
		if (!promotedId) return;
		setPromotedAchievement(achievements.find((achievement) => achievement.id === promotedId) ?? null);
	}, [achievements, currentIndex, selectedSet.id, usageStatsLoaded]);

	const onPromotionComplete = useCallback(() => {
		setPromotedAchievement(null);
	}, []);

	return useMemo(
		() => ({
			achievements,
			currentIndex,
			focusSizeEnabled: usageStatsLoaded,
			labels: {
				setSelector: t("achievement.setSelector"),
			},
			onPromotionComplete,
			onSelectSetId: (nextSetId: string) => {
				setPromotedAchievement(null);
				setSelectedSetId(nextSetId);
			},
			promotedAchievement,
			selectedSetId: selectedSet.id,
			setOptions: ACHIEVEMENT_SETS.map((set) => ({
				id: set.id,
				label: t(set.labelKey, { defaultValue: set.id }),
			})),
			subtitleKey: selectedSet.subtitleKey,
			usageStats,
		}),
		[
			achievements,
			currentIndex,
			onPromotionComplete,
			promotedAchievement,
			selectedSet.id,
			selectedSet.subtitleKey,
			t,
			usageStats,
			usageStatsLoaded,
		],
	);
}
