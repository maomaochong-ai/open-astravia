import type { MediaProviderDescriptor } from "@vetta-org/capability-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

export const AUTO_IMAGE_PROVIDER_ID = "__auto__";

type ImageGenerationMode = "text-to-image" | "image-to-image";
type ImageGenerationRoute = { providerId?: string; modelId?: string };

export interface ImageGenerationProviderOption {
	value: string;
	label: string;
}

export interface ImageGenerationSettingsModel {
	actions: {
		setImageToImageRoute: (value: string) => Promise<void>;
		setTextToImageRoute: (value: string) => Promise<void>;
	};
	imageToImageOptions: readonly ImageGenerationProviderOption[];
	imageToImageRouteId: string;
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
	textToImageRouteId: string;
}

function supportsMode(provider: MediaProviderDescriptor, mode: ImageGenerationMode): boolean {
	return provider.capabilities.some(
		(capability) =>
			capability.operation === "generate" && capability.kind === "image" && capability.modes.includes(mode),
	);
}

function routeId(route: ImageGenerationRoute): string {
	if (!route.providerId) return AUTO_IMAGE_PROVIDER_ID;
	return route.modelId
		? `${encodeURIComponent(route.providerId)}::${encodeURIComponent(route.modelId)}`
		: encodeURIComponent(route.providerId);
}

function parseRouteId(value: string): ImageGenerationRoute {
	if (value === AUTO_IMAGE_PROVIDER_ID) return {};
	const [providerId, modelId] = value.split("::", 2);
	return { providerId: decodeURIComponent(providerId), ...(modelId ? { modelId: decodeURIComponent(modelId) } : {}) };
}

function defaultModelId(provider: MediaProviderDescriptor, mode: ImageGenerationMode): string | undefined {
	for (const capability of provider.capabilities) {
		if (capability.operation === "generate" && capability.kind === "image" && capability.modes.includes(mode)) {
			return capability.defaultModelId;
		}
	}
	return undefined;
}

function selectedRouteId(
	providers: readonly MediaProviderDescriptor[],
	mode: ImageGenerationMode,
	providerId: string | undefined,
	modelId: string | undefined,
): string {
	const provider = providers.find((candidate) => candidate.id === providerId);
	return routeId({ providerId, modelId: modelId ?? (provider ? defaultModelId(provider, mode) : undefined) });
}

function optionsForMode(
	providers: readonly MediaProviderDescriptor[],
	mode: ImageGenerationMode,
	selectedProviderId: string | undefined,
	selectedModelId: string | undefined,
	unavailableLabel: string,
): ImageGenerationProviderOption[] {
	const options: ImageGenerationProviderOption[] = [{ value: AUTO_IMAGE_PROVIDER_ID, label: "" }];
	const candidates = providers.flatMap((provider) => {
		if (!supportsMode(provider, mode)) return [];
		const providerLabel = provider.displayName ?? provider.id;
		const models = provider.capabilities.flatMap((capability) =>
			capability.operation === "generate" && capability.kind === "image"
				? (capability.models ?? []).filter((model) => model.modes.includes(mode))
				: [],
		);
		if (models.length === 0) return [{ value: routeId({ providerId: provider.id }), label: providerLabel }];
		return models.map((model) => ({
			value: routeId({ providerId: provider.id, modelId: model.id }),
			label: `${model.sourceDisplayName ?? providerLabel} · ${model.displayName ?? model.id}`,
		}));
	});
	const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
	const selectedValue = routeId({
		providerId: selectedProviderId,
		modelId: selectedModelId ?? (selectedProvider ? defaultModelId(selectedProvider, mode) : undefined),
	});
	if (selectedProviderId && !candidates.some((candidate) => candidate.value === selectedValue)) {
		options.push({ value: selectedValue, label: `${selectedModelId ?? selectedProviderId} (${unavailableLabel})` });
	}
	return options.concat(candidates);
}

export function useImageGenerationSettingsModel(): ImageGenerationSettingsModel {
	const { t } = useTranslation("settings");
	const [providers, setProviders] = useState<MediaProviderDescriptor[]>([]);
	const [textToImageProviderId, setTextToImageProviderId] = useState<string | undefined>();
	const [textToImageModelId, setTextToImageModelId] = useState<string | undefined>();
	const [imageToImageProviderId, setImageToImageProviderId] = useState<string | undefined>();
	const [imageToImageModelId, setImageToImageModelId] = useState<string | undefined>();
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
			setTextToImageModelId(config.imageGeneration?.textToImageModelId ?? undefined);
			setImageToImageProviderId(config.imageGeneration?.imageToImageProviderId ?? undefined);
			setImageToImageModelId(config.imageGeneration?.imageToImageModelId ?? undefined);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
		return window.vetta.plugins.onMediaProvidersChanged(() => void load());
	}, [load]);

	const setRoute = useCallback(
		async (mode: ImageGenerationMode, value: string): Promise<void> => {
			const route = parseRouteId(value);
			const providerId = route.providerId ?? null;
			const modelId = route.modelId ?? null;
			if (mode === "text-to-image") {
				setTextToImageProviderId(route.providerId);
				setTextToImageModelId(route.modelId);
			} else {
				setImageToImageProviderId(route.providerId);
				setImageToImageModelId(route.modelId);
			}
			const patch =
				mode === "text-to-image"
					? { textToImageProviderId: providerId, textToImageModelId: modelId }
					: { imageToImageProviderId: providerId, imageToImageModelId: modelId };
			try {
				await window.vetta.config.set({ imageGeneration: patch });
				recordSettingsUsage({
					tab: "agent",
					action: providerId ? "selected" : "reset",
					target: mode,
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
				textToImageModelId,
				t("agentSettings.imageGeneration.unavailable"),
			).map((option) =>
				option.value === AUTO_IMAGE_PROVIDER_ID
					? { ...option, label: t("agentSettings.imageGeneration.auto") }
					: option,
			),
		[providers, t, textToImageModelId, textToImageProviderId],
	);
	const imageToImageOptions = useMemo(
		() =>
			optionsForMode(
				providers,
				"image-to-image",
				imageToImageProviderId,
				imageToImageModelId,
				t("agentSettings.imageGeneration.unavailable"),
			).map((option) =>
				option.value === AUTO_IMAGE_PROVIDER_ID
					? { ...option, label: t("agentSettings.imageGeneration.auto") }
					: option,
			),
		[imageToImageModelId, imageToImageProviderId, providers, t],
	);

	return {
		actions: {
			setImageToImageRoute: (value) => setRoute("image-to-image", value),
			setTextToImageRoute: (value) => setRoute("text-to-image", value),
		},
		imageToImageOptions,
		imageToImageRouteId: selectedRouteId(providers, "image-to-image", imageToImageProviderId, imageToImageModelId),
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
		textToImageRouteId: selectedRouteId(providers, "text-to-image", textToImageProviderId, textToImageModelId),
	};
}
