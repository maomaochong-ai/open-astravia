import { themeHostedRoutePath } from "@shared/hosted-routes/hosted-route-descriptors";
import type { ThemePageDefinition } from "@vetta/theme-sdk";
import type { ThemePagesModel } from "@vetta/theme-sdk/pages";
import { themePageRoute } from "./theme-hosted-route-capability.js";
import { isValidThemePageId, resolveThemePageTitle } from "./themePageRegistry.js";

interface ThemePagesSource {
	readonly meta: { readonly id: string };
	readonly pages?: readonly ThemePageDefinition[];
}

export function createThemePagesModel(
	theme: ThemePagesSource,
	language: string,
	currentPath: string,
	openPage: (pageId: string) => void,
): ThemePagesModel {
	const navItems = [...(theme.pages ?? [])]
		.filter((page) => isValidThemePageId(page.id))
		.sort((left, right) => (left.nav?.order ?? 0) - (right.nav?.order ?? 0) || left.id.localeCompare(right.id))
		.map((page) => {
			const path = themeHostedRoutePath(themePageRoute(theme.meta.id, page.id));
			return {
				active: currentPath === path,
				icon: page.nav?.icon,
				key: path,
				label: resolveThemePageTitle(page.title, language),
				pageId: page.id,
			};
		});

	return {
		navItems,
		actions: {
			openPage: (pageId) => {
				openPage(pageId);
			},
		},
	};
}
