import {
	type DesktopSessionHistoryInfo,
	type DesktopSessionOpenTarget,
	resolveDesktopSessionOpenTarget,
} from "@/shared/session-access";

/**
 * 从项目的会话列表里挑出「最新且打得开的一条」。
 *
 * 只按 modifiedAt 排，不套用侧栏那套 pin 优先的次序：用户说的是"最新一条"，
 * 置顶表达的是"常用"，两者不是一回事。
 *
 * 跳过打不开的会话而不是直接失败：权限不足的历史会话仍会出现在列表里，选中它
 * 会让入口整个哑掉，继续往下找是更有用的行为。
 */
export function pickLatestOpenableSession(
	sessions: readonly DesktopSessionHistoryInfo[],
): { readonly session: DesktopSessionHistoryInfo; readonly target: DesktopSessionOpenTarget } | null {
	const ordered = [...sessions].sort((left, right) => right.modifiedAt - left.modifiedAt);
	for (const session of ordered) {
		const target = resolveDesktopSessionOpenTarget(session.access);
		if (target !== "unavailable") return { session, target };
	}
	return null;
}
