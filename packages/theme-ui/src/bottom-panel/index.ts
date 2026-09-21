import type { ThemeSurfaceConfig } from "@vetta-org/theme-sdk";

declare module "@vetta-org/theme-sdk" {
	interface ThemeSurfaceRegistry {
		readonly "bottomPanel.panel"?: ThemeSurfaceConfig;
	}
}

export type {
	BottomPanelEmptyChoice,
	BottomPanelEmptyPickerProps,
	BottomPanelEmptyStateProps,
	BottomPanelFrameProps,
	BottomPanelPillsViewProps,
	BottomPanelTabStatus,
	BottomPanelTabStripLabels,
	BottomPanelTabStripViewProps,
	BottomPanelTabViewModel,
} from "./BottomPanelView";
export {
	BottomPanelEmptyPicker,
	BottomPanelEmptyState,
	BottomPanelFrame,
	BottomPanelPillsView,
	BottomPanelTabStripView,
} from "./BottomPanelView";
