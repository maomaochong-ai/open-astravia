import type { DefaultConversationFilter, SidebarFilter } from "@shared/store/atoms";

export type ProjectFilterLabelKey = "filterTabs.all" | "filterTabs.normal" | "filterTabs.batch";

export type DefaultConversationFilterLabelKey = "filterTabs.conversation" | "filterTabs.claw";

export interface SidebarFilterOption {
	value: SidebarFilter;
	labelKey: ProjectFilterLabelKey;
	icon?: string;
}

export interface DefaultConversationFilterOption {
	value: DefaultConversationFilter;
	labelKey: DefaultConversationFilterLabelKey;
}
