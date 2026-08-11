import { createContext, useContext } from "react";

export interface ActivityTabContextValue {
	/**
	 * The cwd scope of the activity panel this tab is rendered in — the same
	 * key the attach record uses. Do NOT substitute useActiveConversation().cwd:
	 * on the project detail page the panel cwd is the project's, while the
	 * active conversation may belong to another project (or be null).
	 */
	cwd: string | null;
	/** Whether this tab is the selected docked tab or a visible floating tab. */
	active: boolean;
}

/**
 * Internal: the host wraps attached activity-tab components in this context's
 * Provider. Module Federation shares this single SDK instance, so the value
 * the host provides is visible to plugin components.
 */
export const __ActivityTabContext = createContext<ActivityTabContextValue>({ cwd: null, active: false });

/** The panel scope of the activity tab this component is rendered in. */
export function useActivityTab(): ActivityTabContextValue {
	return useContext(__ActivityTabContext);
}
