import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type PageHeaderTitleKey =
	| "appShell.routeTitles.automation"
	| "appShell.routeTitles.batchTasks"
	| "appShell.routeTitles.knowledgeAll"
	| "appShell.routeTitles.knowledge"
	| "appShell.routeTitles.skills"
	| "appShell.routeTitles.scenes"
	| "appShell.routeTitles.plugins"
	| "appShell.routeTitles.settings"
	| "appShell.routeTitles.project"
	| "appShell.routeTitles.chat";

export interface PageHeaderProps {
	readonly className?: string;
	readonly classNames?: PageHeaderClassNames;
	readonly narrow: boolean;
	readonly onExpandSidebar: () => void;
	readonly onOverlayClose: () => void;
	readonly onOverlayOpen: () => void;
	readonly sidebarCollapsed: boolean;
}

export interface PageHeaderClassNames {
	readonly actions?: string;
	readonly content?: string;
	readonly left?: string;
	readonly sidebarTrigger?: string;
	readonly title?: string;
}

export type PageHeaderModelInput = Pick<PageHeaderProps, "narrow" | "sidebarCollapsed">;

export interface PageHeaderModel {
	readonly fallbackTitleKey?: PageHeaderTitleKey;
	readonly leftSlot: ReactNode;
	readonly path: string;
	readonly rightSlot: ReactNode;
	readonly sidebarTriggerTitle: string;
	readonly title: string;
	readonly titleBadge: ReactNode;
	readonly titleHidden: boolean;
	readonly triggerVisible: boolean;
}

export interface PageHeaderRegionProps extends PageHeaderProps {
	readonly model: PageHeaderModel;
}

export interface PageHeaderContentProps {
	readonly actions: Pick<PageHeaderProps, "onExpandSidebar" | "onOverlayClose" | "onOverlayOpen">;
	readonly classNames?: PageHeaderClassNames;
	readonly model: PageHeaderModel;
	readonly narrow: boolean;
}

export interface PageHeaderSidebarTriggerProps extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
	readonly iconClassName?: string;
}

export type WindowControlKind = "close" | "maximize" | "minimize" | "restore";

export interface WindowControlItem {
	readonly action: () => void;
	readonly kind: WindowControlKind;
	readonly label: string;
}

export interface WindowControlsModel {
	readonly controls: readonly WindowControlItem[];
	readonly isMac: boolean;
	readonly isMaximized: boolean;
}

export interface WindowControlsProps {
	readonly className?: string;
	readonly classNames?: {
		readonly button?: string;
		readonly closeButton?: string;
		readonly icon?: string;
	};
}

export interface WindowControlsComponentProps extends WindowControlsProps {
	readonly model: WindowControlsModel;
}

export interface WindowControlButtonProps extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
	readonly control: WindowControlItem;
	readonly iconClassName?: string;
}

export interface AppShellThemeHost {
	readonly usePageHeaderModel: (input: PageHeaderModelInput) => PageHeaderModel;
	readonly useWindowControlsModel: () => WindowControlsModel;
}
