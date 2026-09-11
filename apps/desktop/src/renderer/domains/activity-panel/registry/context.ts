import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import { createContext, useContext } from "react";

export interface ActivityPanelContextValue {
	workspace: ActivityWorkspace;
	/** 知识库会话：面板仅展示 knowledge-history。 */
	knowledgeHistory: boolean;
}

const ActivityPanelContext = createContext<ActivityPanelContextValue>({
	workspace: { id: "unbound", cwd: null, runtimeIds: [] },
	knowledgeHistory: false,
});

export const ActivityPanelContextProvider = ActivityPanelContext.Provider;

export function useActivityPanelContext(): ActivityPanelContextValue {
	return useContext(ActivityPanelContext);
}

export function useActivityPanelCwd(): string | null {
	return useContext(ActivityPanelContext).workspace.cwd;
}

export function useActivityWorkspace(): ActivityWorkspace {
	return useContext(ActivityPanelContext).workspace;
}

/** Runtime sessions the current workspace aggregates per-runtime activity for. */
export function useActivityRuntimeIds(): readonly string[] {
	return useContext(ActivityPanelContext).workspace.runtimeIds;
}
