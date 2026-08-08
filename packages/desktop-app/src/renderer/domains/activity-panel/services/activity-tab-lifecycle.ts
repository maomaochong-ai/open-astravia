import type { ActivityTabKey } from "@shared/lib/project-profile";
import type { ResolvedActivityTab } from "../registry/types";

export function resolveMountedActivityTabs(
	candidates: readonly ResolvedActivityTab[],
	floatingKeys: ReadonlySet<ActivityTabKey>,
	activeTab: ActivityTabKey,
): ResolvedActivityTab[] {
	return candidates.filter(
		(item) =>
			item.definition.keepAliveWhenAvailable || floatingKeys.has(item.id as ActivityTabKey) || item.id === activeTab,
	);
}
