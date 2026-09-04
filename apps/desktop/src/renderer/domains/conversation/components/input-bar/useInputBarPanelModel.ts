import { activityPanelOpenAtom, activityPanelTabByProjectAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";

/** 输入栏抽屉和活动面板的组合状态。 */
export function useInputBarPanelModel(
	activeSession: { cwd: string; runtimeId: string } | null,
	activityWorkspaceId?: string,
) {
	const [drawerActiveTab, setDrawerActiveTab] = useState<string | null>(null);
	const setActivityPanelOpen = useSetAtom(activityPanelOpenAtom);
	const setTabByProject = useSetAtom(activityPanelTabByProjectAtom);

	useEffect(() => {
		if (!activeSession) setDrawerActiveTab(null);
	}, [activeSession]);

	const openTodoPanel = useCallback(() => {
		const workspaceId = activityWorkspaceId ?? activeSession?.cwd;
		if (!workspaceId) return;
		setDrawerActiveTab(null);
		setActivityPanelOpen(true);
		setTabByProject((prev) => {
			const map = new Map(prev);
			map.set(workspaceId, "todo");
			return map;
		});
	}, [activityWorkspaceId, activeSession?.cwd, setActivityPanelOpen, setTabByProject]);

	return { drawerActiveTab, openTodoPanel, setDrawerActiveTab };
}
