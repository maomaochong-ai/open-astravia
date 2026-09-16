import type { MediaProviderDescriptor } from "@vetta-org/capability-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

export const AUTO_IMAGE_PROVIDER_ID = "__auto__";

type ImageGenerationMode = "text-to-image" | "image-to-image";
type ProviderField = "textToImageProviderId" | "imageToImageProviderId";

export interface ImageGenerationProviderOption {
	value: string;
	label: string;
}

export interface ImageGenerationSettingsModel {
	actions: {
		setImageToImageProvider: (value: string) => Promise<void>;
		setTextToImageProvider: (value: string) => Promise<void>;
	};
	imageToImageOptions: readonly ImageGenerationProviderOption[];
	imageToImageProviderId: string;
	labels: {
		description: string;
		imageToImage: string;
		loading: string;
		noProviders: string;
		textToImage: string;
		title: string;
	};
	loading: boolean;
	textToImageOptions: readonly ImageGenerationProviderOption[];
	textToImageProviderId: string;
}

function supportsMode(provider: MediaProviderDescriptor, mode: ImageGenerationMode): boolean {
	return provider.capabilities.some(
		(capability) =>
			capability.operation === "generate" && capability.kind === "image" && capability.modes.includes(mode),
	);
}

function optionsForMode(
	providers: readonly MediaProviderDescriptor[],
	mode: ImageGenerationMode,
	selectedProviderId: string | undefined,
	unavailableLabel: string,
): ImageGenerationProviderOption[] {
	const options: ImageGenerationProviderOption[] = [{ value: AUTO_IMAGE_PROVIDER_ID, label: "" }];
	const candidates = providers
		.filter((provider) => supportsMode(provider, mode))
		.map((provider) => ({ value: provider.id, label: provider.displayName ?? provider.id }));
	if (selectedProviderId && !candidates.some((provider) => provider.value === selectedProviderId)) {
		options.push({ value: selectedProviderId, label: `${selectedProviderId} (${unavailableLabel})` });
	}
	return options.concat(candidates);
}

export function useImageGenerationSettingsModel(): ImageGenerationSettingsModel {
	const { t } = useTranslation("settings");
	const [providers, setProviders] = useState<MediaProviderDescriptor[]>([]);
	const [textToImageProviderId, setTextToImageProviderId] = useState<string | undefined>();
	const [imageToImageProviderId, setImageToImageProviderId] = useState<string | undefined>();
	const [loading, setLoading] = useState(true);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [nextProviders, config] = await Promise.all([
				window.vetta.media.listProviders(),
				window.vetta.config.get(),
			]);
			setProviders(nextProviders);
			setTextToImageProviderId(config.imageGeneration?.textToImageProviderId ?? undefined);
			setImageToImageProviderId(config.imageGeneration?.imageToImageProviderId ?? undefined);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
		return window.vetta.plugins.onMediaProvidersChanged(() => void load());
	}, [load]);

	const setProvider = useCallback(
		async (field: ProviderField, value: string): Promise<void> => {
			const providerId = value === AUTO_IMAGE_PROVIDER_ID ? null : value;
			if (field === "textToImageProviderId") setTextToImageProviderId(providerId ?? undefined);
			else setImageToImageProviderId(providerId ?? undefined);
			try {
				await window.vetta.config.set({ imageGeneration: { [field]: providerId } });
				recordSettingsUsage({
					tab: "agent",
					action: providerId ? "selected" : "reset",
					target: field,
				});
			} catch {
				await load();
			}
		},
		[load],
	);

	const textToImageOptions = useMemo(
		() =>
			optionsForMode(
				providers,
				"text-to-image",
				textToImageProviderId,
				t("agentSettings.imageGeneration.unavailable"),
			).map((option) =>
				option.value === AUTO_IMAGE_PROVIDER_ID
					? { ...option, label: t("agentSettings.imageGeneration.auto") }
					: option,
			),
		[providers, t, textToImageProviderId],
	);
	const imageToImageOptions = useMemo(
		() =>
			optionsForMode(
				providers,
				"image-to-image",
				imageToImageProviderId,
				t("agentSettings.imageGeneration.unavailable"),
			).map((option) =>
				option.value === AUTO_IMAGE_PROVIDER_ID
					? { ...option, label: t("agentSettings.imageGeneration.auto") }
					: option,
			),
		[imageToImageProviderId, providers, t],
	);

	return {
		actions: {
			setImageToImageProvider: (value) => setProvider("imageToImageProviderId", value),
			setTextToImageProvider: (value) => setProvider("textToImageProviderId", value),
		},
		imageToImageOptions,
		imageToImageProviderId: imageToImageProviderId ?? AUTO_IMAGE_PROVIDER_ID,
		labels: {
			description: t("agentSettings.imageGeneration.description"),
			imageToImage: t("agentSettings.imageGeneration.imageToImage"),
			loading: t("agentSettings.imageGeneration.loading"),
			noProviders: t("agentSettings.imageGeneration.noProviders"),
			textToImage: t("agentSettings.imageGeneration.textToImage"),
			title: t(SETTINGS_SECTION["agent-images"].titleKey),
		},
		loading,
		textToImageOptions,
		textToImageProviderId: textToImageProviderId ?? AUTO_IMAGE_PROVIDER_ID,
	};
}
