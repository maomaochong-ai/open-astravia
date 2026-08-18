import type {
	PageHeaderContentProps,
	PageHeaderSidebarTrigger,
	PageHeaderTitle,
	PageHeaderWindowActions,
	WindowControlButton,
	WindowControlsComponentProps,
} from "@vetta/theme-ui/app-shell";
import type { ComponentType } from "react";

export { usePageHeaderModel, useWindowControlsModel } from "@vetta/theme-sdk/app-shell";
export type {
	DefaultPageHeaderProps,
	PageHeaderActionGroupProps,
	PageHeaderClassNames,
	PageHeaderContentProps,
	PageHeaderFrameProps,
	PageHeaderModel,
	PageHeaderProps,
	PageHeaderRegionProps,
	PageHeaderSidebarTriggerProps,
	PageHeaderTitleKey,
	PageHeaderTitleProps,
	PageHeaderWindowActionsProps,
	WindowControlButtonProps,
	WindowControlItem,
	WindowControlKind,
	WindowControlsComponentProps,
	WindowControlsModel,
	WindowControlsProps,
} from "@vetta/theme-ui/app-shell";
export {
	DefaultPageHeader,
	DefaultWindowControls,
	PageHeaderActionGroup,
	PageHeaderContent,
	PageHeaderFrame,
	PageHeaderSidebarTrigger,
	PageHeaderTitle,
	PageHeaderWindowActions,
	WindowControlButton,
} from "@vetta/theme-ui/app-shell";

declare module "@vetta/theme-sdk" {
	interface ThemeComponentRegistry {
		readonly "app.pageHeaderContent"?: ComponentType<PageHeaderContentProps>;
		readonly "app.pageHeaderSidebarTrigger"?: typeof PageHeaderSidebarTrigger;
		readonly "app.pageHeaderTitle"?: typeof PageHeaderTitle;
		readonly "app.pageHeaderWindowActions"?: typeof PageHeaderWindowActions;
		readonly "app.windowControls"?: ComponentType<WindowControlsComponentProps>;
		readonly "app.windowControlButton"?: typeof WindowControlButton;
	}
}
