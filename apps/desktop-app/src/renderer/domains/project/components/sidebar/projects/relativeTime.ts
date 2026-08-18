import type { TFunction } from "i18next";

/** 侧边栏会话相对时间；文案走 project ns，须由调用方传入当前语言的 t。 */
export function relativeTime(timestamp: number, t: TFunction<"project">): string {
	const now = Date.now();
	const diff = now - timestamp;
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return t("sidebar.time.justNow");
	if (minutes < 60) return t("sidebar.time.minutes", { n: minutes });
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return t("sidebar.time.hours", { n: hours });
	const days = Math.floor(hours / 24);
	if (days < 7) return t("sidebar.time.days", { n: days });
	const weeks = Math.floor(days / 7);
	if (weeks < 5) return t("sidebar.time.weeks", { n: weeks });
	const months = Math.floor(days / 30);
	if (months < 12) return t("sidebar.time.months", { n: months });
	return t("sidebar.time.years", { n: Math.floor(months / 12) });
}
