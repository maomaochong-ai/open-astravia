import {
	DEFAULT_NEW_SESSION_PAGE_VISIBILITY,
	type NewSessionPageVisibility,
	newSessionPageVisibilityAtom,
} from "@shared/store/atoms";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

export interface NewSessionSettingsModel {
	actions: {
		toggleGuidingWords: (checked: boolean) => void;
		toggleSceneCards: (checked: boolean) => void;
		toggleSkillBadges: (checked: boolean) => void;
	};
	labels: NewSessionSettingsLabels;
	visibility: NewSessionPageVisibility;
}

interface NewSessionSettingsLabels {
	guidingWords: string;
	guidingWordsDescription: string;
	pageDescription: string;
	sceneCards: string;
	sceneCardsDescription: string;
	sections: {
		elements: string;
	};
	skillBadges: string;
	skillBadgesDescription: string;
	title: string;
}

export function useNewSessionSettingsModel(): NewSessionSettingsModel {
	const { t } = useTranslation("settings");
	const [visibility, setVisibility] = useAtom(newSessionPageVisibilityAtom);

	useEffect(() => {
		void window.vetta.config.get().then((config) => {
			const page = config.newSessionPage;
			setVisibility({
				showSceneCards: page?.showSceneCards === true,
				showSkillBadges: page?.showSkillBadges !== false,
				showGuidingWords: page?.showGuidingWords === true,
			});
		});
	}, [setVisibility]);

	const persist = useCallback(
		(patch: Partial<NewSessionPageVisibility>, target: string) => {
			setVisibility((current) => {
				const next = { ...current, ...patch };
				void window.vetta.config.set({ newSessionPage: next });
				return next;
			});
			const enabled = Object.values(patch)[0] === true;
			recordSettingsUsage({
				tab: "newSession",
				action: enabled ? "enabled" : "disabled",
				target,
			});
		},
		[setVisibility],
	);

	const toggleSceneCards = useCallback(
		(checked: boolean) => {
			persist({ showSceneCards: checked }, "scene-cards");
		},
		[persist],
	);

	const toggleSkillBadges = useCallback(
		(checked: boolean) => {
			persist({ showSkillBadges: checked }, "skill-badges");
		},
		[persist],
	);

	const toggleGuidingWords = useCallback(
		(checked: boolean) => {
			persist({ showGuidingWords: checked }, "guiding-words");
		},
		[persist],
	);

	const labels = useMemo<NewSessionSettingsLabels>(
		() => ({
			guidingWords: t("newSessionSettings.guidingWords"),
			guidingWordsDescription: t("newSessionSettings.guidingWordsDesc"),
			pageDescription: t("newSessionSettings.pageDescription"),
			sceneCards: t("newSessionSettings.sceneCards"),
			sceneCardsDescription: t("newSessionSettings.sceneCardsDesc"),
			sections: {
				elements: t(SETTINGS_SECTION["new-session-elements"].titleKey),
			},
			skillBadges: t("newSessionSettings.skillBadges"),
			skillBadgesDescription: t("newSessionSettings.skillBadgesDesc"),
			title: t("newSessionSettings.title"),
		}),
		[t],
	);

	return {
		actions: {
			toggleGuidingWords,
			toggleSceneCards,
			toggleSkillBadges,
		},
		labels,
		visibility: visibility ?? DEFAULT_NEW_SESSION_PAGE_VISIBILITY,
	};
}
