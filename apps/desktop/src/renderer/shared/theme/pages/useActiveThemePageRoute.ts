import { useMatches } from "@tanstack/react-router";
import type { ThemePageDefinition, ThemePageLayout } from "@vetta/theme-sdk";
import { useThemeModule } from "@vetta/theme-sdk";
import { findThemePage, getThemePageLayout } from "./themePageRegistry";

interface ThemePageRouteParams {
	readonly pageId: string;
	readonly themeId: string;
}

export interface ActiveThemePageRoute extends ThemePageRouteParams {
	readonly isThemePageRoute: true;
	readonly layout: ThemePageLayout;
	readonly page: ThemePageDefinition | undefined;
}

function readThemePageRouteParams(params: Record<string, unknown> | undefined): ThemePageRouteParams | undefined {
	const themeId = params?.themeId;
	const pageId = params?.pageId;
	if (typeof themeId !== "string" || typeof pageId !== "string") return undefined;
	return { themeId, pageId };
}

export function useActiveThemePageRoute(): ActiveThemePageRoute | undefined {
	const theme = useThemeModule();
	const matches = useMatches();
	const currentMatch = matches[matches.length - 1];
	const params = readThemePageRouteParams(currentMatch?.params as Record<string, unknown> | undefined);
	if (!params) return undefined;

	const page = findThemePage(theme, params.themeId, params.pageId);
	return {
		...params,
		isThemePageRoute: true,
		layout: page ? getThemePageLayout(page) : "content",
		page,
	};
}
