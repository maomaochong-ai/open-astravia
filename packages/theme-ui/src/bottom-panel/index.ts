import type { ThemeSurfaceConfig } from "@astravia-org/theme-sdk";

declare module "@astravia-org/theme-sdk" {
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
