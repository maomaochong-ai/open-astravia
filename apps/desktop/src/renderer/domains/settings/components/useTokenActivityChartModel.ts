import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TokenActivityChartViewProps } from "./TokenActivityChartView";
import { useUsageSeries } from "./useUsageSeries";

export type TokenActivityChartModel = TokenActivityChartViewProps | null;

export function useTokenActivityChartModel(): TokenActivityChartModel {
	const { t, i18n } = useTranslation("settings");
	const { loading, points, token } = useUsageSeries();

	const labels = useMemo(
		() => ({
			title: t("tokenActivity.title"),
			daily: t("tokenActivity.daily"),
			weekly: t("tokenActivity.weekly"),
			cumulative: t("tokenActivity.cumulative"),
			empty: t("tokenActivity.empty"),
			tokens: (count: string) => t("tokenActivity.tokens", { count }),
			month: (yearMonth: string) => {
				const [y, m] = yearMonth.split("-").map(Number);
				if (!y || !m) return yearMonth;
				const d = new Date(y, m - 1, 1);
				return d.toLocaleString(i18n.language.startsWith("zh") ? "zh-CN" : "en", {
					month: "short",
				});
			},
		}),
		[t, i18n.language],
	);

	if (!token) return null;
	return { points, loading, labels };
}
