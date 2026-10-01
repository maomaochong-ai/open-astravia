import type { ThemeHost } from "@astravia-org/theme-sdk";
import { useSidebarModel } from "@domains/project/components/sidebar/useSidebarModel";
import { usePageHeaderModel } from "@shared/app-shell/page-header/usePageHeaderModel";
import { useWindowControlsModel } from "@shared/app-shell/window-controls/useWindowControlsModel";
import { useThemePagesModel } from "@shared/theme/pages/useThemePagesModel";
import { useThemeRouteModel } from "@shared/theme/routing/useThemeRouteModel";
import { useThemeStorage } from "@shared/theme/storage";
import { useThemeUsageStats } from "@shared/theme/usage";

export const desktopThemeHost: ThemeHost = {
	appShell: {
		usePageHeaderModel,
		useWindowControlsModel,
	},
	pages: {
		useThemePagesModel,
	},
	routing: {
		useThemeRouteModel,
	},
	sidebar: {
		useSidebarModel,
	},
	storage: {
		useThemeStorage,
	},
	usage: {
		useThemeUsageStats,
	},
};
