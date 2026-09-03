import { defaultConversationFilterAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

/** Keep direct links and post-create navigation aligned with the sidebar's team source. */
export function useAgentTeamSidebarSelection(): void {
	const setDefaultConversationFilter = useSetAtom(defaultConversationFilterAtom);

	useEffect(() => {
		setDefaultConversationFilter("team");
	}, [setDefaultConversationFilter]);
}
