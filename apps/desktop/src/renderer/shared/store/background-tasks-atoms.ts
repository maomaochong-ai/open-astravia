import { atom } from "jotai";

export interface BackgroundTask {
	id: string;
	command: string;
	cwd: string;
	status: "running" | "completed" | "failed" | "killed";
	outputFile: string;
	exitCode: number | undefined;
	startedAt: number;
	endedAt?: number;
	toolCallId?: string;
	/** 输出尾部（约 2KB），用于实时滚动显示。 */
	tail: string;
	/** status 为 killed 时，记录终止来源（caller / agent / dispose）。 */
	endedBy?: "caller" | "agent" | "dispose";
}

/**
 * 后台 bash 任务（run_in_background）状态。
 * 由 Coding Agent 后台任务扩展观察驱动全量更新，按 sessionId 隔离。
 * Map<sessionId, BackgroundTask[]>
 */
export const backgroundTasksBySessionAtom = atom<Map<string, BackgroundTask[]>>(new Map());

export function getBackgroundTasksForSession(
	map: Map<string, BackgroundTask[]>,
	sessionId: string | null | undefined,
): BackgroundTask[] {
	if (!sessionId) return [];
	return map.get(sessionId) ?? [];
}
