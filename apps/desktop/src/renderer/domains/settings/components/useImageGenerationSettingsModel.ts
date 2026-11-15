import type { MediaProviderDescriptor } from "@astravia-org/capability-sdk";
import type { CustomImageProviderSummary } from "@preload/api-types/media.js";
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

export interface CustomImageProviderDraft {
	id?: string;
	name: string;
	baseUrl: string;
	apiKey: string;
	model: string;
	supportsTextToImage: boolean;
	supportsImageToImage: boolean;
	/** 编辑时：库里已有 key，留空即沿用。 */
	hasStoredApiKey: boolean;
}

type CustomLabelKey =
	| "add"
	| "apiKey"
	| "apiKeyKeepHint"
	| "baseUrl"
	| "cancel"
	| "delete"
	| "description"
	| "edit"
	| "model"
	| "name"
	| "save"
	| "supportsImageToImage"
	| "supportsTextToImage"
	| "title";

const CUSTOM_LABEL_KEYS: readonly CustomLabelKey[] = [
	"add",
	"apiKey",
	"apiKeyKeepHint",
	"baseUrl",
	"cancel",
	"delete",
	"description",
	"edit",
	"model",
	"name",
	"save",
	"supportsImageToImage",
	"supportsTextToImage",
	"title",
];

export interface ImageGenerationSettingsModel {
	/** 自定义 OpenAI 兼容图片服务：列表、内联表单与保存。 */
	custom: {
		providers: readonly CustomImageProviderSummary[];
		draft: CustomImageProviderDraft | null;
		error: string | null;
		saving: boolean;
		startAdd: () => void;
		startEdit: (id: string) => void;
		cancel: () => void;
		updateDraft: (patch: Partial<CustomImageProviderDraft>) => void;
		save: () => Promise<void>;
		remove: (id: string) => Promise<void>;
		labels: Record<CustomLabelKey, string>;
	};
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
	const [customProviders, setCustomProviders] = useState<CustomImageProviderSummary[]>([]);
	const [draft, setDraft] = useState<CustomImageProviderDraft | null>(null);
	const [customError, setCustomError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [nextProviders, config] = await Promise.all([
				window.astravia.media.listProviders(),
				window.astravia.config.get(),
			]);
			setProviders(nextProviders);
			// 自定义服务是后加的能力：旧宿主（或测试替身）没有这组方法时按空列表处理，
			// 不能让整块图片设置跟着读不出来。
			try {
				const nextCustomProviders = await window.astravia.media.customImageProviders?.list();
				setCustomProviders(nextCustomProviders ?? []);
			} catch {
				setCustomProviders([]);
			}
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
		return window.astravia.plugins.onMediaProvidersChanged(() => void load());
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
				await window.astravia.config.set({ imageGeneration: patch });
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

	const startAdd = useCallback(() => {
		setCustomError(null);
		setDraft({
			name: "",
			baseUrl: "",
			apiKey: "",
			model: "",
			supportsTextToImage: true,
			supportsImageToImage: false,
			hasStoredApiKey: false,
		});
	}, []);

	const startEdit = useCallback(
		(id: string) => {
			const entry = customProviders.find((candidate) => candidate.id === id);
			if (!entry) return;
			setCustomError(null);
			setDraft({
				id: entry.id,
				name: entry.name,
				baseUrl: entry.baseUrl,
				apiKey: "",
				model: entry.model,
				supportsTextToImage: entry.supportsTextToImage,
				supportsImageToImage: entry.supportsImageToImage,
				hasStoredApiKey: entry.hasApiKey,
			});
		},
		[customProviders],
	);

	const cancelDraft = useCallback(() => {
		setDraft(null);
		setCustomError(null);
	}, []);

	const updateDraft = useCallback((patch: Partial<CustomImageProviderDraft>) => {
		setDraft((current) => (current ? { ...current, ...patch } : current));
	}, []);

	const saveDraft = useCallback(async (): Promise<void> => {
		if (!draft) return;
		const name = draft.name.trim();
		const model = draft.model.trim();
		const baseUrl = draft.baseUrl.trim();
		const apiKey = draft.apiKey.trim();
		if (!name || !model || !baseUrl) return setCustomError(t("agentSettings.imageGeneration.custom.errors.required"));
		if (!/^https?:\/\//i.test(baseUrl)) {
			return setCustomError(t("agentSettings.imageGeneration.custom.errors.baseUrl"));
		}
		if (!draft.supportsTextToImage && !draft.supportsImageToImage) {
			return setCustomError(t("agentSettings.imageGeneration.custom.errors.capability"));
		}
		if (!apiKey && !draft.hasStoredApiKey) {
			return setCustomError(t("agentSettings.imageGeneration.custom.errors.apiKey"));
		}
		setSaving(true);
		setCustomError(null);
		try {
			await window.astravia.media.customImageProviders.save({
				...(draft.id ? { id: draft.id } : {}),
				name,
				baseUrl,
				model,
				supportsTextToImage: draft.supportsTextToImage,
				supportsImageToImage: draft.supportsImageToImage,
				...(apiKey ? { apiKey } : {}),
			});
			setDraft(null);
			recordSettingsUsage({ tab: "agent", action: "saved", target: "custom-image-provider" });
			await load();
		} catch (error) {
			// 主进程的校验错误文案不含 key；key 只存在于 draft 里，不进错误。
			const message =
				error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': /, "") : "";
			setCustomError(t("agentSettings.imageGeneration.custom.errors.saveFailed", { message }));
		} finally {
			setSaving(false);
		}
	}, [draft, load, t]);

	const removeCustom = useCallback(
		async (id: string): Promise<void> => {
			try {
				await window.astravia.media.customImageProviders.remove(id);
				recordSettingsUsage({ tab: "agent", action: "deleted", target: "custom-image-provider" });
			} finally {
				await load();
			}
		},
		[load],
	);

	const customLabels = useMemo(
		() =>
			Object.fromEntries(
				CUSTOM_LABEL_KEYS.map((key) => [key, t(`agentSettings.imageGeneration.custom.${key}`)]),
			) as Record<CustomLabelKey, string>,
		[t],
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
		custom: {
			providers: customProviders,
			draft,
			error: customError,
			saving,
			startAdd,
			startEdit,
			cancel: cancelDraft,
			updateDraft,
			save: saveDraft,
			remove: removeCustom,
			labels: customLabels,
		},
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
