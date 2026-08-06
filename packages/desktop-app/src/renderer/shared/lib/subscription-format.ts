import type { SubscriptionWindow } from "@preload/api.js";

/** 窗口类型 → settings 命名空间下的 i18n key。模块级常量不存文案,渲染期再 t()。 */
export const WINDOW_LABEL_KEYS = {
	"5h": "subWindow5h",
	week: "subWindowWeek",
	month: "subWindowMonth",
} as const satisfies Record<SubscriptionWindow["kind"], string>;

/** 格式化到期日(到天)。 */
export function formatExpiry(iso?: string): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 倒计时的 i18n key 与插值参数。文案由调用方在渲染期 t() 出来。 */
export type ResetCountdown =
	| { key: "subResetImminent"; params?: undefined }
	| { key: "subResetInDays"; params: { days: number; hours: number } }
	| { key: "subResetInHours"; params: { hours: number; mins: number } }
	| { key: "subResetInMinutes"; params: { mins: number } };

/** 距离 resetAt 的倒计时;已过期给「即将重置」。iso 非法时返回 null(不展示)。 */
export function getResetCountdown(iso: string, now: number): ResetCountdown | null {
	const target = new Date(iso).getTime();
	if (Number.isNaN(target)) return null;
	const diff = target - now;
	if (diff <= 0) return { key: "subResetImminent" };
	const totalMin = Math.floor(diff / 60000);
	const days = Math.floor(totalMin / 1440);
	const hours = Math.floor((totalMin % 1440) / 60);
	const mins = totalMin % 60;
	if (days > 0) return { key: "subResetInDays", params: { days, hours } };
	if (hours > 0) return { key: "subResetInHours", params: { hours, mins } };
	return { key: "subResetInMinutes", params: { mins } };
}
