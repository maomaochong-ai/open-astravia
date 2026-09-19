import { useCallback, useEffect, useState } from "react";
import { useOpenActivityTab } from "../../hooks/useOpenActivityTab";

/** 输入栏抽屉和活动面板的组合状态。 */
export function useInputBarPanelModel(
	activeSession: { cwd: string; runtimeId: string } | null,
	activityWorkspaceId?: string,
) {
	const [drawerActiveTab, setDrawerActiveTab] = useState<string | null>(null);
	const openActivityTab = useOpenActivityTab(activityWorkspaceId ?? activeSession?.cwd);

	useEffect(() => {
		if (!activeSession) setDrawerActiveTab(null);
	}, [activeSession]);

	const openTodoPanel = useCallback(() => {
		if (!(activityWorkspaceId ?? activeSession?.cwd)) return;
		setDrawerActiveTab(null);
		openActivityTab("todo");
	}, [activityWorkspaceId, activeSession?.cwd, openActivityTab]);

	return { drawerActiveTab, openTodoPanel, setDrawerActiveTab };
}
