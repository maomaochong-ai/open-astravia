import type { SidebarSessionSearchViewTimeFilter } from "@vetta/theme-ui/project";
import type { TFunction } from "i18next";
import { useCallback, useState } from "react";
import { enUS, zhCN } from "react-day-picker/locale";
import type { SessionSearchTimeSelection } from "../services/session-search-time-filter";
import {
	formatLocalDate,
	parseLocalDate,
	resolveSessionSearchTimeRange,
	SESSION_SEARCH_TIME_PRESETS,
} from "../services/session-search-time-filter";

const EMPTY_TIME_SELECTION: SessionSearchTimeSelection = { preset: "all", startDate: "", endDate: "" };

export function useSessionSearchTimeFilter(t: TFunction<"project">, locale: string) {
	const [selection, setSelection] = useState(EMPTY_TIME_SELECTION);
	const reset = useCallback(() => setSelection(EMPTY_TIME_SELECTION), []);
	const range = resolveSessionSearchTimeRange(selection);
	const options = SESSION_SEARCH_TIME_PRESETS.map((key) => ({ key, label: t(`sidebar.search.timePresets.${key}`) }));
	const error = range.error ? t(`sidebar.search.timeErrors.${range.error}`) : undefined;
	let activeLabel = t(`sidebar.search.timePresets.${selection.preset}`);
	if (selection.preset === "custom" && !error) {
		if (selection.startDate && selection.endDate) {
			activeLabel = t("sidebar.search.dateRange", { start: selection.startDate, end: selection.endDate });
		} else if (selection.startDate) {
			activeLabel = t("sidebar.search.dateFrom", { date: selection.startDate });
		} else {
			activeLabel = t("sidebar.search.dateThrough", { date: selection.endDate });
		}
	}
	const view: SidebarSessionSearchViewTimeFilter = {
		value: selection.preset,
		options,
		startDate: parseLocalDate(selection.startDate),
		endDate: parseLocalDate(selection.endDate),
		datePicker: {
			locale: locale.startsWith("zh") ? zhCN : enUS,
			labels: {
				placeholder: t("sidebar.search.calendar.placeholder"),
				clear: t("sidebar.search.calendar.clear"),
				today: t("sidebar.search.calendar.today"),
				selected: t("sidebar.search.calendar.selected"),
				month: t("sidebar.search.calendar.month"),
				year: t("sidebar.search.calendar.year"),
				previousMonth: t("sidebar.search.calendar.previousMonth"),
				nextMonth: t("sidebar.search.calendar.nextMonth"),
			},
		},
		error,
		onValueChange: (value) => {
			const preset = SESSION_SEARCH_TIME_PRESETS.find((key) => key === value);
			if (preset) setSelection((previous) => ({ ...previous, preset }));
		},
		onStartDateChange: (date) => setSelection((previous) => ({ ...previous, startDate: formatLocalDate(date) })),
		onEndDateChange: (date) => setSelection((previous) => ({ ...previous, endDate: formatLocalDate(date) })),
	};
	return { view, range, activeLabel, active: selection.preset !== "all", reset };
}
