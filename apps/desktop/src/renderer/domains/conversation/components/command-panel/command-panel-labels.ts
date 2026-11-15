import type { AddPanelTab } from "./add-panel-catalog";
import type { CommandPanelLabels } from "./types";

/** 只需要「按 key 取译文」的能力，便于在不依赖 i18n 实例的地方构造文案（测试、预览）。 */
export type Translate = (key: string) => string;

/**
 * 把 i18n 的 `t` 投影成面板需要的文案表。
 *
 * 单独成模块而不是留在 hook 里：这段是纯映射，没有任何状态或副作用，留在 500 行的
 * hook 里既让 hook 显得更重，也没法单独验证「每个键都取到了」。
 */
export function buildCommandPanelLabels(t: Translate): CommandPanelLabels {
	const categoryLabel = (target: AddPanelTab): string =>
		target === "favorites" ? t("slashPanel.favorites") : t(`slashPanel.sections.${target}`);

	return {
		searchPlaceholder: t("slashPanel.searchPlaceholder"),
		clearSearch: t("slashPanel.clearSearch"),
		favorites: t("slashPanel.favorites"),
		favoritesEmpty: t("slashPanel.favoritesEmpty"),
		favoritesEmptyHint: t("slashPanel.favoritesEmptyHint"),
		categories: t("slashPanel.categories"),
		openAbilityPlaza: t("slashPanel.openAbilityPlaza"),
		categoryLabel,
		groupLabel: (titleKey: string) => t(titleKey),
		categoryEmpty: t("slashPanel.categoryEmpty"),
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
			hintSkill: t("slashPanel.preview.hintSkill"),
			hintConnector: t("slashPanel.preview.hintConnector"),
			hintFile: t("slashPanel.preview.hintFile"),
			hintExtension: t("slashPanel.preview.hintExtension"),
		},
		hints: {
			navigate: t("slashPanel.hints.navigate"),
			insert: t("slashPanel.hints.insert"),
			details: t("slashPanel.hints.details"),
			close: t("slashPanel.hints.close"),
		},
	};
}
