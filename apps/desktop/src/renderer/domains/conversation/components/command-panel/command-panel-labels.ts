import type { TFunction } from "i18next";
import type { AddPanelTab } from "./add-panel-catalog";
import type { CommandPanelLabels } from "./types";

/**
 * 把 i18n 的 `t` 投影成面板需要的文案表。
 *
 * 单独成模块而不是留在 hook 里：这段是纯映射，没有任何状态或副作用，留在 500 行的
 * hook 里既让 hook 显得更重，也没法单独验证「每个键都取到了」。
 */
export function buildCommandPanelLabels(t: TFunction<"chat">): CommandPanelLabels {
	const categoryLabel = (target: AddPanelTab): string => {
		if (target === "favorites") return t("slashPanel.favorites");
		if (target === "all") return t("slashPanel.all");
		if (target === "operations") return t("slashPanel.operations");
		return t(`slashPanel.sections.${target}`);
	};

	return {
		searchPlaceholder: t("slashPanel.searchPlaceholder"),
		clearSearch: t("slashPanel.clearSearch"),
		favorites: t("slashPanel.favorites"),
		favoritesEmpty: t("slashPanel.favoritesEmpty"),
		favoritesEmptyHint: t("slashPanel.favoritesEmptyHint"),
		categories: t("slashPanel.categories"),
		all: t("slashPanel.all"),
		operations: t("slashPanel.operations"),
		openAbilityPlaza: t("slashPanel.openAbilityPlaza"),
		categoryLabel,
		// 分组标题的 key 由目录模块给出，字面量集合与 chat.json 同步；这里收窄到该命名空间。
		groupLabel: (titleKey: string) => t(titleKey as "slashPanel.sections.skills"),
		categoryEmpty: (category: string) => t("slashPanel.categoryEmpty", { category }),
		operationsEmptyHint: t("slashPanel.operationsEmptyHint"),
		emptyNoMatch: t("slashPanel.emptyNoMatch"),
		emptyNoMatchHint: t("slashPanel.emptyNoMatchHint"),
		emptyNoSkills: t("slashPanel.emptyNoSkills"),
		emptyNoSkillsHint: t("slashPanel.emptyNoSkillsHint"),
		favoriteAdd: t("slashPanel.favoriteAdd"),
		favoriteRemove: t("slashPanel.favoriteRemove"),
		details: t("slashPanel.details"),
		preview: {
			back: t("slashPanel.preview.back"),
			sourceLabel: t("slashPanel.preview.sourceLabel"),
			statusLabel: t("slashPanel.preview.statusLabel"),
			statusConnected: t("slashPanel.preview.statusConnected"),
			insertLabel: t("slashPanel.preview.insertLabel"),
		},
		hints: {
			scrollToolsLeft: t("slashPanel.hints.scrollToolsLeft"),
			scrollToolsRight: t("slashPanel.hints.scrollToolsRight"),
			scrollRailUp: t("slashPanel.hints.scrollRailUp"),
			scrollRailDown: t("slashPanel.hints.scrollRailDown"),
		},
	};
}
