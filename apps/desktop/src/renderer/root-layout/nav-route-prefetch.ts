import type { SidebarNavItem } from "@vetta-org/theme-sdk/sidebar";
import {
	loadAbilitiesPage,
	loadAgentCenterPage,
	loadAutomationPage,
	loadBatchTasksPage,
	loadKnowledgeBasePage,
	loadNewSessionPage,
	loadPluginWorkspaceViewRoute,
	loadScenesPage,
	loadSettingsPage,
} from "../route-page-loaders";

type PageLoader = () => Promise<unknown>;

export function navItemPageLoader(item: SidebarNavItem): PageLoader | null {
	if (item.type === "new-session") return loadNewSessionPage;
	if (item.workspaceView) return loadPluginWorkspaceViewRoute;
	if (item.settingsTab) return loadSettingsPage;
	switch (item.path) {
		case "/abilities":
		case "/skills":
		case "/plugins":
			return loadAbilitiesPage;
		case "/agents":
			return loadAgentCenterPage;
		case "/automation":
			return loadAutomationPage;
		case "/batch-tasks":
			return loadBatchTasksPage;
		case "/knowledge":
			return loadKnowledgeBasePage;
		case "/scenes":
			return loadScenesPage;
		default:
			return null;
	}
}

/** Prefetch only a route module; React.lazy still owns the actual page lifecycle. */
function prefetchPageCode(load: PageLoader | null): void {
	if (!load) return;
	void load().catch(() => {
		// Navigation handles errors normally; a hover must never surface one.
	});
}

export function prefetchNavItem(item: SidebarNavItem): void {
	prefetchPageCode(navItemPageLoader(item));
}

export function commandMenuPageLoader(kind: string): PageLoader | null {
	switch (kind) {
		case "openSettingsSection":
			return loadSettingsPage;
		case "openAbilities":
			return loadAbilitiesPage;
		case "openWorkspaceView":
			return loadPluginWorkspaceViewRoute;
		default:
			return null;
	}
}

export function prefetchCommandMenuAction(action: { readonly kind: string }): void {
	prefetchPageCode(commandMenuPageLoader(action.kind));
}
