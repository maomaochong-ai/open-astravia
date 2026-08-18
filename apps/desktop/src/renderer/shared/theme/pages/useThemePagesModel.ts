import { useMatches } from "@tanstack/react-router";
import { useThemeModule } from "@vetta/theme-sdk";
import type { ThemePagesModel } from "@vetta/theme-sdk/pages";
import { useTranslation } from "react-i18next";
import { createThemePagesModel } from "./theme-pages-model.js";
import { themeRendererCapabilityHost } from "./theme-renderer-capability-host.js";

export function useThemePagesModel(): ThemePagesModel {
	const theme = useThemeModule();
	const { i18n } = useTranslation();
	const matches = useMatches();
	const currentPath = matches[matches.length - 1]?.pathname ?? "/";
	return createThemePagesModel(theme, i18n.language, currentPath, (pageId) => {
		void themeRendererCapabilityHost.openPage(theme.meta.id, pageId);
	});
}
