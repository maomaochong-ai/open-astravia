import type { ActivityTabKey } from "@shared/lib/project-profile";
import { activityPanelOpenAtom, activityPanelTabByProjectAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useCallback } from "react";

/** 打开右侧活动面板并切到指定 tab；`workspaceId` 缺省时（尚无会话）不做任何事。 */
export function useOpenActivityTab(workspaceId: string | undefined): (tabId: ActivityTabKey) => void {
	const setActivityPanelOpen = useSetAtom(activityPanelOpenAtom);
	const setTabByProject = useSetAtom(activityPanelTabByProjectAtom);
	return useCallback(
		(tabId) => {
			if (!workspaceId) return;
			setActivityPanelOpen(true);
			setTabByProject((prev) => new Map(prev).set(workspaceId, tabId));
		},
		[setActivityPanelOpen, setTabByProject, workspaceId],
	);
}
