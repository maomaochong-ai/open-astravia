import { TitledPageShell } from "@shared/components/TitledPageShell";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { resolveThemePageTitle } from "./themePageRegistry";
import { useActiveThemePageRoute } from "./useActiveThemePageRoute";

export function themePageShellTitle(
	pageTitle: Readonly<Record<string, string>> | undefined,
	language: string,
	fallback: string,
): string {
	if (!pageTitle) return fallback;
	return resolveThemePageTitle(pageTitle, language) || fallback;
}

function useThemePageShellTitle(override?: { themeId: string; pageId: string }): string {
	const { i18n, t } = useTranslation("settings");
	const route = useActiveThemePageRoute(override);
	return themePageShellTitle(route?.page?.title, i18n.language, t("theme.title"));
}

export function ThemePageRouteShell({
	themeId,
	pageId,
}: { themeId?: string; pageId?: string } = {}): JSX.Element {
	const override = themeId !== undefined && pageId !== undefined ? { themeId, pageId } : undefined;
	const title = useThemePageShellTitle(override);
	return <TitledPageShell title={title} />;
}
