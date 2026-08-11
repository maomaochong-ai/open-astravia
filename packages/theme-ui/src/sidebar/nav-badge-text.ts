import type { SidebarNavBadge } from "@vetta/theme-sdk/sidebar";

/** 计数超过这个值只显示 `99+`：导航项宽度有限，再大的真实数字也没有信息量。 */
export const NAV_BADGE_COUNT_OVERFLOW = 99;

/**
 * 角标胶囊里显示什么文字。返回 null = 不渲染胶囊。
 *
 * `dot` 本就没有文本；`count` 归零时返回 null 而不是「0」——未读清零该让角标
 * 消失，挂一个 0 比没有更糟。
 */
export function navBadgeText(badge: SidebarNavBadge): string | null {
	if (badge.kind === "dot") return null;
	if (badge.kind === "count") {
		if (badge.count <= 0) return null;
		return badge.count > NAV_BADGE_COUNT_OVERFLOW ? `${NAV_BADGE_COUNT_OVERFLOW}+` : String(badge.count);
	}
	return badge.text.trim() || null;
}
