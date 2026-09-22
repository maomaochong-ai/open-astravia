import type { AutomationSchedule } from "../../../shared/automation";

/**
 * Built-in automation templates shown when the user has no scheduled tasks.
 * User-facing strings live in i18n (`automation.recommend.items.<id>.*`).
 */
export interface RecommendedAutomationTaskTemplate {
	readonly id: "morningBrief" | "dailySummary" | "weeklyReview";
	/** Iconify class used by the empty-state cards. */
	readonly icon: string;
	readonly schedule: AutomationSchedule;
}

export const RECOMMENDED_AUTOMATION_TASKS: readonly RecommendedAutomationTaskTemplate[] = [
	{
		id: "morningBrief",
		icon: "icon-[mdi--weather-sunny]",
		schedule: { kind: "weekly", weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 0 },
	},
	{
		id: "dailySummary",
		icon: "icon-[mdi--clipboard-text-outline]",
		schedule: { kind: "daily", hour: 18, minute: 0 },
	},
	{
		id: "weeklyReview",
		icon: "icon-[mdi--chart-timeline-variant]",
		schedule: { kind: "weekly", weekdays: [5], hour: 17, minute: 0 },
	},
] as const;
