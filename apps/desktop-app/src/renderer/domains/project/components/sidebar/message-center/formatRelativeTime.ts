import type { TFunction } from "i18next";

/** 消息中心相对时间；文案走 message ns，须由调用方传入当前语言的 t。 */
export function formatRelativeTime(dateStr: string, t: TFunction<"message">): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return t("time.justNow");
	if (minutes < 60) return t("time.minutesAgo", { n: minutes });
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return t("time.hoursAgo", { n: hours });
	const days = Math.floor(hours / 24);
	return t("time.daysAgo", { n: days });
}
