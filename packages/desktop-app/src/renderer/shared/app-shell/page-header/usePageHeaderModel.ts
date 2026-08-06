import {
	pageHeaderLeftSlotAtom,
	pageHeaderRightSlotAtom,
	pageHeaderTitleAtom,
	pageHeaderTitleBadgeAtom,
	pageHeaderTitleHiddenAtom,
} from "@shared/store/atoms";
import { resolveThemePageTitle, useActiveThemePageRoute } from "@shared/theme/pages";
import { useMatches } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import type { PageHeaderModel, PageHeaderProps, PageHeaderTitleKey } from "./types";

const ROUTE_TITLE_KEYS: Array<{ match: RegExp; titleKey: PageHeaderTitleKey }> = [
	{ match: /^\/automation$/, titleKey: "appShell.routeTitles.automation" },
	{ match: /^\/batch-tasks$/, titleKey: "appShell.routeTitles.batchTasks" },
	{ match: /^\/knowledge\/all$/, titleKey: "appShell.routeTitles.knowledgeAll" },
	{ match: /^\/knowledge$/, titleKey: "appShell.routeTitles.knowledge" },
	{ match: /^\/abilities\b/, titleKey: "appShell.routeTitles.skills" },
	{ match: /^\/scenes$/, titleKey: "appShell.routeTitles.scenes" },
	{ match: /^\/settings\b/, titleKey: "appShell.routeTitles.settings" },
	{ match: /^\/project\b/, titleKey: "appShell.routeTitles.project" },
	{ match: /^\/$/, titleKey: "appShell.routeTitles.chat" },
];

export function usePageHeaderModel({
	narrow,
	sidebarCollapsed,
}: Pick<PageHeaderProps, "narrow" | "sidebarCollapsed">): PageHeaderModel {
	const { i18n, t } = useTranslation("common");
	const matches = useMatches();
	const themePageRoute = useActiveThemePageRoute();
	const path = matches[matches.length - 1]?.pathname ?? "/";
	const titleOverride = useAtomValue(pageHeaderTitleAtom);
	const titleHidden = useAtomValue(pageHeaderTitleHiddenAtom);
	const titleBadge = useAtomValue(pageHeaderTitleBadgeAtom);
	const rightSlot = useAtomValue(pageHeaderRightSlotAtom);
	const leftSlot = useAtomValue(pageHeaderLeftSlotAtom);
	const fallbackTitleKey = ROUTE_TITLE_KEYS.find((route) => route.match.test(path))?.titleKey;
	const themePageTitle = themePageRoute?.page
		? resolveThemePageTitle(themePageRoute.page.title, i18n.language)
		: undefined;
	const fallbackTitle = themePageTitle || (fallbackTitleKey ? t(fallbackTitleKey) : t("appName"));
	const title = titleOverride && titleOverride.length > 0 ? titleOverride : fallbackTitle;
	const triggerVisible = narrow || sidebarCollapsed;
	const sidebarTriggerTitle = t(narrow ? "appShell.sidebarTrigger.open" : "appShell.sidebarTrigger.expand");

	return {
		fallbackTitleKey,
		leftSlot,
		path,
		rightSlot,
		sidebarTriggerTitle,
		title,
		titleBadge,
		titleHidden,
		triggerVisible,
	};
}
