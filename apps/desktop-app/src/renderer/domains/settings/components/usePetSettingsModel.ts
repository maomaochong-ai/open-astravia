import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PetBubbleStyleAsset, PetDecoration } from "../../../../preload/api-types/pet";
import { PET_BUBBLE_STYLES, type PetBubbleStyleId } from "../../../../shared/pet-bubbles";
import { DEFAULT_PET_CONFIG, type PetConfig } from "../../../../shared/pet-config";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

export interface PetBubbleStyleModel {
	decorUrl?: string;
	description: string;
	id: PetBubbleStyleId;
	label: string;
}

export interface PetSettingsModel {
	actions: {
		changeAlwaysOnTop: (checked: boolean) => void;
		changeBubbleStyle: (value: string) => void;
		changeDebugFrame: (checked: boolean) => void;
		changeEnabled: (checked: boolean) => void;
	};
	bubbleStyles: PetBubbleStyleModel[];
	config: PetConfig;
	decorations: PetDecoration[];
	labels: {
		alwaysOnTop: string;
		alwaysOnTopDescription: string;
		bubbleSectionDescription: string;
		debugFrame: string;
		debugFrameDescription: string;
		decorationAvailable: string;
		decorationMissing: string;
		decorationSectionDescription: string;
		developerDescription: string;
		materialMissing: string;
		pageTitle: string;
		sections: {
			bubble: string;
			decoration: string;
			developer: string;
			display: string;
		};
		showPet: string;
		showPetDescription: string;
	};
}

export function usePetSettingsModel(): PetSettingsModel {
	const { t } = useTranslation("pet");
	const { t: tSettings } = useTranslation("settings");
	const [config, setConfig] = useState<PetConfig>(DEFAULT_PET_CONFIG);
	const [decorations, setDecorations] = useState<PetDecoration[]>([]);
	const [bubbleStyleAssets, setBubbleStyleAssets] = useState<PetBubbleStyleAsset[]>([]);

	useEffect(() => {
		let disposed = false;
		let receivedConfigEvent = false;
		const unsubscribe = window.vetta.pet.onConfigChanged((next) => {
			receivedConfigEvent = true;
			if (!disposed) setConfig(next);
		});
		void window.vetta.pet.getConfig().then((next) => {
			if (!disposed && !receivedConfigEvent) setConfig(next);
		});
		void window.vetta.pet.getDecorations().then(setDecorations);
		void window.vetta.pet.getBubbleStyleAssets().then((next) => {
			setBubbleStyleAssets(next);
		});
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, []);

	const persist = useCallback(async (patch: Partial<PetConfig>) => {
		setConfig((current) => ({ ...current, ...patch }));
		const next = await window.vetta.pet.setConfig(patch);
		setConfig(next);
	}, []);

	const handleEnabled = useCallback((checked: boolean) => {
		setConfig((current) => ({ ...current, enabled: checked }));
		const request = checked ? window.vetta.pet.show() : window.vetta.pet.hide();
		void request.then(setConfig);
		recordSettingsUsage({ tab: "pet", action: checked ? "enabled" : "disabled", target: "pet-window" });
	}, []);

	const handleAlwaysOnTop = useCallback(
		(checked: boolean) => {
			void persist({ alwaysOnTop: checked });
			recordSettingsUsage({ tab: "pet", action: checked ? "enabled" : "disabled", target: "always-on-top" });
		},
		[persist],
	);

	const handleDebugFrame = useCallback(
		(checked: boolean) => {
			void persist({ debugFrame: checked });
			recordSettingsUsage({ tab: "pet", action: checked ? "enabled" : "disabled", target: "debug-frame" });
		},
		[persist],
	);

	const handleBubbleStyle = useCallback(
		(value: string) => {
			void persist({ bubbleStyleId: value as PetBubbleStyleId });
			recordSettingsUsage({ tab: "pet", action: "selected", target: "bubble-style", value });
		},
		[persist],
	);

	const bubbleStyles = useMemo<PetBubbleStyleModel[]>(
		() =>
			PET_BUBBLE_STYLES.map((style) => ({
				id: style.id,
				decorUrl: bubbleStyleAssets.find((asset) => asset.id === style.id)?.url,
				description: t(style.descriptionKey),
				label: t(style.labelKey),
			})),
		[bubbleStyleAssets, t],
	);

	const localizedDecorations = useMemo(
		() =>
			decorations.map((decoration) => ({
				...decoration,
				label: t(decoration.labelKey),
			})),
		[decorations, t],
	);

	const labels = useMemo(
		() => ({
			alwaysOnTop: t("settings.alwaysOnTop"),
			alwaysOnTopDescription: t("settings.alwaysOnTopDesc"),
			bubbleSectionDescription: t("settings.bubble.sectionDescription"),
			debugFrame: t("settings.debugFrame"),
			debugFrameDescription: t("settings.debugFrameDesc"),
			decorationAvailable: t("settings.decoration.available"),
			decorationMissing: t("settings.decoration.missing"),
			decorationSectionDescription: t("settings.decoration.sectionDescription"),
			developerDescription: t("settings.developerDesc"),
			materialMissing: t("settings.decoration.materialMissing"),
			pageTitle: t("settings.pageTitle"),
			sections: {
				bubble: tSettings(SETTINGS_SECTION["pet-bubble"].titleKey),
				decoration: tSettings(SETTINGS_SECTION["pet-decoration"].titleKey),
				developer: tSettings(SETTINGS_SECTION["pet-developer"].titleKey),
				display: tSettings(SETTINGS_SECTION["pet-display"].titleKey),
			},
			showPet: t("settings.showPet"),
			showPetDescription: t("settings.showPetDesc"),
		}),
		[t, tSettings],
	);

	return {
		actions: {
			changeAlwaysOnTop: handleAlwaysOnTop,
			changeBubbleStyle: handleBubbleStyle,
			changeDebugFrame: handleDebugFrame,
			changeEnabled: handleEnabled,
		},
		bubbleStyles,
		config,
		decorations: localizedDecorations,
		labels,
	};
}
