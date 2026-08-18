import type { SessionInfo } from "@shared/store/atoms";
import { type DesktopSessionOpenTarget, resolveDesktopSessionOpenTarget } from "@/shared/session-access";

/**
 * 决定点击一条侧栏会话该走交互式恢复、只读 viewer 还是不可用。
 *
 * 关键前提：`sessions` 必须是**该条会话真正所属 cwd** 的列表。Claw 会话存放在
 * im-gateway 自己的 cwd（ADR-0005）下，用默认「对话」项目的 cwd 去查会查空，
 * 于是 access 缺失、回落成 "interactive"，主进程再以 SESSION_READ_ONLY 拒绝，
 * 表现为点击毫无反应、永远进不了只读视图。
 */
export function resolveSessionOpenTarget(
	sessions: readonly SessionInfo[] | undefined,
	sessionPath: string,
): DesktopSessionOpenTarget {
	const session = sessions?.find((item) => item.path === sessionPath);
	// 乐观创建的本地条目可能还没解析出 access，此时按交互式打开（旧行为）。
	if (!session?.access) return "interactive";
	return resolveDesktopSessionOpenTarget(session.access);
}
