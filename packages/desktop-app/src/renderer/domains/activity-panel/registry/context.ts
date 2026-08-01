import { createContext, useContext } from "react";

export interface ActivityPanelContextValue {
	cwd: string | null;
	/** 知识库会话：面板仅展示 knowledge-history。 */
	knowledgeHistory: boolean;
}

const ActivityPanelContext = createContext<ActivityPanelContextValue>({
	cwd: null,
	knowledgeHistory: false,
});

export const ActivityPanelContextProvider = ActivityPanelContext.Provider;

export function useActivityPanelContext(): ActivityPanelContextValue {
	return useContext(ActivityPanelContext);
}

export function useActivityPanelCwd(): string | null {
	return useContext(ActivityPanelContext).cwd;
}
