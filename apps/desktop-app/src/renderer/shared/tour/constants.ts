/** Product tour localStorage keys — each tour runs at most once. */
export const SIDEBAR_TOUR_STORAGE_KEY = "vetta.tour.sidebar.completed";
export const CAPABILITIES_TOUR_STORAGE_KEY = "vetta.tour.capabilities.completed";

/** DOM anchors via data-tour attribute. */
export const TOUR_ANCHORS = {
	sidebarProjects: "sidebar-projects",
	sidebarConversations: "sidebar-conversations",
	sidebarNavSkills: "sidebar-nav-skills",
	capabilitiesBanner: "capabilities-banner",
	capabilitiesSearchAdd: "capabilities-search-add",
	capabilitiesScope: "capabilities-scope",
	capabilitiesList: "capabilities-list",
} as const;

export function tourSelector(anchor: string): string {
	return `[data-tour="${anchor}"]`;
}
