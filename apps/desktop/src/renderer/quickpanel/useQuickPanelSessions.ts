import { useCallback, useEffect, useMemo, useState } from "react";
import type { QuickPanelBridge, QuickPanelSession } from "../../shared/quickpanel-ipc";

declare global {
	interface Window {
		vettaQuickPanel?: QuickPanelBridge;
	}
}

export type QuickPanelItemStatus = "running" | "pending-question" | "idle";

export interface QuickPanelItem extends QuickPanelSession {
	status: QuickPanelItemStatus;
}

const RECENT_LIMIT = 8;

function toggle(set: ReadonlySet<string>, key: string, on: boolean): ReadonlySet<string> {
	if (on === set.has(key)) return set;
	const next = new Set(set);
	if (on) next.add(key);
	else next.delete(key);
	return next;
}

// 拉取最近「对话」会话 + 实时合并 running / 待答 状态。数据合并思路对齐
// ProjectsPanel：列表项静态来自 listRecent，运行/待答态来自广播事件叠加。
export function useQuickPanelSessions(): QuickPanelItem[] {
	const [sessions, setSessions] = useState<QuickPanelSession[]>([]);
	const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());
	const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

	const refresh = useCallback(async () => {
		const bridge = window.vettaQuickPanel;
		if (!bridge) return;
		const list = await bridge.listRecent(RECENT_LIMIT);
		setSessions(list);
	}, []);

	useEffect(() => {
		const bridge = window.vettaQuickPanel;
		if (!bridge) return;
		void refresh();
		const offShown = bridge.onShown(() => {
			void refresh();
		});
		const offRunning = bridge.onRunningChanged(({ sessionPath, running: isRunning }) => {
			setRunning((prev) => toggle(prev, sessionPath, isRunning));
		});
		const offPending = bridge.onPendingQuestionChanged(({ sessionPath, hasPendingQuestion }) => {
			setPending((prev) => toggle(prev, sessionPath, hasPendingQuestion));
		});
		return () => {
			offShown();
			offRunning();
			offPending();
		};
	}, [refresh]);

	return useMemo(
		() =>
			sessions.map((session) => ({
				...session,
				status: pending.has(session.sessionPath)
					? "pending-question"
					: running.has(session.sessionPath)
						? "running"
						: "idle",
			})),
		[sessions, running, pending],
	);
}
