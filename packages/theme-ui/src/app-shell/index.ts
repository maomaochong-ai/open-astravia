import type { WindowControlsComponentProps } from "@vetta-org/theme-sdk/app-shell";
import type { ComponentType } from "react";
import type { PageHeaderContentProps } from "./PageHeaderContent";
import type { PageHeaderSidebarTrigger } from "./PageHeaderSidebarTrigger";
import type { PageHeaderTitle } from "./PageHeaderTitle";
import type { PageHeaderWindowActions } from "./PageHeaderWindowActions";
import type { WindowControlButton } from "./WindowControlButton";

declare module "@vetta-org/theme-sdk" {
	interface ThemeComponentRegistry {
		readonly "app.pageHeaderContent"?: ComponentType<PageHeaderContentProps>;
		readonly "app.pageHeaderSidebarTrigger"?: typeof PageHeaderSidebarTrigger;
		readonly "app.pageHeaderTitle"?: typeof PageHeaderTitle;
		readonly "app.pageHeaderWindowActions"?: typeof PageHeaderWindowActions;
		readonly "app.windowControls"?: ComponentType<WindowControlsComponentProps>;
		readonly "app.windowControlButton"?: typeof WindowControlButton;
	}
}

export type {
	PageHeaderClassNames,
	PageHeaderModel,
	PageHeaderModelInput,
	PageHeaderProps,
	PageHeaderRegionProps,
	PageHeaderSidebarTriggerProps,
	PageHeaderTitleKey,
	WindowControlButtonProps,
	WindowControlItem,
	WindowControlKind,
	WindowControlsComponentProps,
	WindowControlsModel,
	WindowControlsProps,
} from "@vetta-org/theme-sdk/app-shell";
export type { DefaultPageHeaderProps } from "./DefaultPageHeader";
export { DefaultPageHeader } from "./DefaultPageHeader";
export { DefaultWindowControls } from "./DefaultWindowControls";
export type { PageHeaderActionGroupProps } from "./PageHeaderActionGroup";
export { PageHeaderActionGroup } from "./PageHeaderActionGroup";
export type { PageHeaderContentProps } from "./PageHeaderContent";
export { PageHeaderContent } from "./PageHeaderContent";
export type { PageHeaderFrameProps } from "./PageHeaderFrame";
export { PageHeaderFrame } from "./PageHeaderFrame";
export { PageHeaderSidebarTrigger } from "./PageHeaderSidebarTrigger";
export type { PageHeaderTitleProps } from "./PageHeaderTitle";
export { PageHeaderTitle } from "./PageHeaderTitle";
export type { PageHeaderWindowActionsProps } from "./PageHeaderWindowActions";
export { PageHeaderWindowActions } from "./PageHeaderWindowActions";
export { WindowControlButton } from "./WindowControlButton";
