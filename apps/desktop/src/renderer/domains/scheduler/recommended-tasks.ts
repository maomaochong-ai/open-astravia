/**
 * Built-in automation templates shown when the user has no scheduled tasks.
 * User-facing strings live in i18n (`automation.recommend.items.<id>.*`).
 * Cron expressions use node-cron format: minute hour day month weekday.
 */

export interface RecommendedAutomationTaskTemplate {
	readonly id: "morningBrief" | "dailySummary" | "weeklyReview";
	/** Iconify class used by the empty-state cards. */
	readonly icon: string;
	readonly cron: string;
	readonly isOnce: boolean;
}

export const RECOMMENDED_AUTOMATION_TASKS: readonly RecommendedAutomationTaskTemplate[] = [
	{
		id: "morningBrief",
		icon: "icon-[mdi--weather-sunny]",
		// Weekdays 09:00
		cron: "0 9 * * 1,2,3,4,5",
		isOnce: false,
	},
	{
		id: "dailySummary",
		icon: "icon-[mdi--clipboard-text-outline]",
		// Every day 18:00
		cron: "0 18 * * *",
		isOnce: false,
	},
	{
		id: "weeklyReview",
		icon: "icon-[mdi--chart-timeline-variant]",
		// Friday 17:00
		cron: "0 17 * * 5",
		isOnce: false,
	},
] as const;
