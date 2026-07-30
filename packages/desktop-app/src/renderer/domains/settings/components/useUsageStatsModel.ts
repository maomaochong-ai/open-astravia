import { countUsageStreak, sumUsageTotals } from "@shared/lib/usage-stats";
import type { UsageStatsRange, UsageStatsViewProps } from "@vetta/theme-ui/settings";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUsageSeries } from "./useUsageSeries";

export type UsageStatsModel = UsageStatsViewProps | null;

const RANGE_DAYS: Record<UsageStatsRange, number | null> = { "7d": 7, "30d": 30, all: null };

export function useUsageStatsModel(): UsageStatsModel {
	const { t } = useTranslation("settings");
	const { loading, points, token } = useUsageSeries();
	const [tokensRange, setTokensRange] = useState<UsageStatsRange>("30d");
	const [requestsRange, setRequestsRange] = useState<UsageStatsRange>("30d");

	const tokensTotal = useMemo(
		() => sumUsageTotals(points, RANGE_DAYS[tokensRange], new Date()).tokens,
		[points, tokensRange],
	);
	const requestsTotal = useMemo(
		() => sumUsageTotals(points, RANGE_DAYS[requestsRange], new Date()).requests,
		[points, requestsRange],
	);
	const streakDays = useMemo(() => countUsageStreak(points, new Date()), [points]);

	const labels = useMemo(
		() => ({
			days: (count: number) => t("usageStats.days", { count }),
			range: (range: UsageStatsRange) => t(`usageStats.range.${range}`),
			streak: t("usageStats.streak"),
		}),
		[t],
	);

	if (!token) return null;
	return {
		labels,
		loading,
		requests: {
			onRangeChange: setRequestsRange,
			range: requestsRange,
			total: requestsTotal,
			unit: t("usageStats.unitRequests"),
		},
		streakDays,
		tokens: {
			onRangeChange: setTokensRange,
			range: tokensRange,
			total: tokensTotal,
			unit: t("usageStats.unitTokens"),
		},
	};
}
