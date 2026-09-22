import type { TFunction } from "i18next";
import type { AutomationSchedule } from "../../../../../shared/automation";
import { pad2, sortMonthDays } from "./automation-schedule";

/** 列表、审批与表单共用的「重复」描述。 */
export function describeSchedule(schedule: AutomationSchedule, t: TFunction<"automation">): string {
	switch (schedule.kind) {
		case "once": {
			const date = new Date(schedule.at);
			return t("schedule.once", {
				date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
				time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
			});
		}
		case "hourly":
			return t("schedule.hourly", { minute: pad2(schedule.minute) });
		case "daily":
			return t("schedule.daily", { time: `${pad2(schedule.hour)}:${pad2(schedule.minute)}` });
		case "weekly": {
			const names = t("schedule.weekdayNames", { returnObjects: true }) as string[];
			const days = [...schedule.weekdays].sort((a, b) => a - b).map((day) => names[day]);
			return t("schedule.weekly", {
				days: days.join(t("schedule.weekdayJoin")),
				time: `${pad2(schedule.hour)}:${pad2(schedule.minute)}`,
			});
		}
		case "monthly": {
			const days = sortMonthDays(schedule.days).map((day) =>
				day === "last" ? t("schedule.lastDay") : t("schedule.monthDay", { day }),
			);
			return t("schedule.monthly", {
				days: days.join(t("schedule.weekdayJoin")),
				time: `${pad2(schedule.hour)}:${pad2(schedule.minute)}`,
			});
		}
		case "custom":
			return t("schedule.custom");
	}
}
