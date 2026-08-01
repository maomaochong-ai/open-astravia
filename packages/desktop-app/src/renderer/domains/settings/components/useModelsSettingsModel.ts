import type { ModelsConfigData } from "@preload/api.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { recordSettingsUsage } from "./recordSettingsUsage";

export type ProviderEntry = ModelsConfigData["providers"][string];
export type ModelEntry = NonNullable<ProviderEntry["models"]>[number];

export interface ProviderFormState {
	name: string;
	baseUrl: string;
	apiKey: string;
	api: string;
	headers: string;
	authHeader: boolean;
}

export interface ModelFormState {
	id: string;
	name: string;
	api: string;
	reasoning: boolean;
	reasoningLevels: string[];
	defaultReasoningLevel: string;
	input: string[];
	contextWindow: string;
	maxTokens: string;
}

export interface EditingModelState {
	provider: string;
	modelId: string;
}

/** 「从 /models 接口拉取」面板状态：某个 provider 拉到的模型 id 与勾选情况。 */
export interface FetchedModelsState {
	provider: string;
	models: string[];
	selected: string[];
	error?: string;
}

export interface ModelsSettingsModel {
	config: ModelsConfigData | null;
	providerNames: string[];
	expandedProvider: string | null;
	addingProvider: boolean;
	providerForm: ProviderFormState;
	editingProvider: string | null;
	addingModelFor: string | null;
	editingModel: EditingModelState | null;
	modelForm: ModelFormState;
	saving: boolean;
	fetchingModelsFor: string | null;
	fetchedModels: FetchedModelsState | null;
	setProviderForm: React.Dispatch<React.SetStateAction<ProviderFormState>>;
	setModelForm: React.Dispatch<React.SetStateAction<ModelFormState>>;
	saveConfig: (newConfig: ModelsConfigData) => Promise<void>;
	onStartAddProvider: () => void;
	onCancelAddProvider: () => void;
	onAddProvider: () => Promise<void>;
	onStartEditProvider: (name: string) => void;
	onCancelEditProvider: () => void;
	onUpdateProvider: (oldName: string) => Promise<void>;
	onDeleteProvider: (name: string) => Promise<void>;
	onToggleProvider: (name: string) => void;
	onStartAddModel: (providerName: string) => void;
	onCancelAddModel: () => void;
	onAddModel: (providerName: string) => Promise<void>;
	onStartEditModel: (providerName: string, modelId: string) => void;
	onCancelEditModel: () => void;
	onUpdateModel: (providerName: string, oldModelId: string) => Promise<void>;
	onDeleteModel: (providerName: string, modelId: string) => Promise<void>;
	onSetDefaultModel: (providerName: string, modelId: string) => Promise<void>;
	onFetchProviderModels: (providerName: string) => Promise<void>;
	onToggleFetchedModel: (modelId: string) => void;
	onCancelFetchedModels: () => void;
	onApplyFetchedModels: (providerName: string) => Promise<void>;
}

export const API_OPTIONS = [
	"openai-completions",
	"openai-responses",
	"azure-openai-responses",
	"openai-codex-responses",
	"anthropic-messages",
	"bedrock-converse-stream",
	"google-generative-ai",
	"google-gemini-cli",
	"google-vertex",
	"nvidia-openai-responses",
	"qwen-openai-completions",
	"zai-openai-completions",
	"zhipu-openai-completions",
].map((api) => ({ value: api, label: api }));

export const INPUT_OPTIONS = [
	{ value: "text", label: "Text" },
	{ value: "image", label: "Image" },
];

export const CANDIDATE_REASONING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max", "none"];

export const emptyProvider: ProviderFormState = {
	name: "",
	baseUrl: "",
	apiKey: "",
	api: "openai-completions",
	headers: "",
	authHeader: false,
};

export const emptyModel: ModelFormState = {
	id: "",
	name: "",
	api: "",
	reasoning: false,
	reasoningLevels: [],
	defaultReasoningLevel: "",
	input: ["text"],
	contextWindow: "",
	maxTokens: "",
};

export function useModelsSettingsModel(): ModelsSettingsModel {
	const [config, setConfig] = useState<ModelsConfigData | null>(null);
	const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
	const [addingProvider, setAddingProvider] = useState(false);
	const [providerForm, setProviderForm] = useState<ProviderFormState>({ ...emptyProvider });
	const [editingProvider, setEditingProvider] = useState<string | null>(null);
	const [addingModelFor, setAddingModelFor] = useState<string | null>(null);
	const [editingModel, setEditingModel] = useState<EditingModelState | null>(null);
	const [modelForm, setModelForm] = useState<ModelFormState>({ ...emptyModel });
	const [saving, setSaving] = useState(false);
	const [fetchingModelsFor, setFetchingModelsFor] = useState<string | null>(null);
	const [fetchedModels, setFetchedModels] = useState<FetchedModelsState | null>(null);

	useEffect(() => {
		void window.vetta.models.get().then((loadedConfig) => {
			setConfig(loadedConfig);
		});
	}, []);

	const saveConfig = useCallback(async (newConfig: ModelsConfigData) => {
		setSaving(true);
		try {
			await window.vetta.models.set(newConfig);
			setConfig(await window.vetta.models.get());
		} finally {
			setSaving(false);
		}
	}, []);

	const providerFormToData = useCallback(() => {
		const headers = parseHeadersString(providerForm.headers);
		return {
			baseUrl: providerForm.baseUrl.trim() || undefined,
			apiKey: providerForm.apiKey.trim() || undefined,
			api: providerForm.api || undefined,
			headers,
			authHeader: providerForm.authHeader || undefined,
		};
	}, [providerForm]);

	const handleAddProvider = useCallback(async () => {
		if (!config || !providerForm.name.trim()) return;
		const name = providerForm.name.trim();
		await saveConfig({
			...config,
			providers: {
				...config.providers,
				[name]: {
					...providerFormToData(),
					models: [],
				},
			},
		});
		setAddingProvider(false);
		setProviderForm({ ...emptyProvider });
		setExpandedProvider(name);
		recordSettingsUsage({ tab: "models", action: "added", target: "provider", value: providerForm.api });
	}, [config, providerForm.api, providerForm.name, providerFormToData, saveConfig]);

	const handleUpdateProvider = useCallback(
		async (oldName: string) => {
			if (!config || !providerForm.name.trim()) return;
			const newProviders = { ...config.providers };
			const existing = newProviders[oldName];
			if (!existing) return;

			const nextName = providerForm.name.trim();
			if (oldName !== nextName) {
				delete newProviders[oldName];
			}

			newProviders[nextName] = {
				...existing,
				...providerFormToData(),
			};

			await saveConfig({ ...config, providers: newProviders });
			setEditingProvider(null);
			setProviderForm({ ...emptyProvider });
			if (oldName !== nextName) {
				setExpandedProvider(nextName);
			}
			recordSettingsUsage({ tab: "models", action: "updated", target: "provider", value: providerForm.api });
		},
		[config, providerForm.api, providerForm.name, providerFormToData, saveConfig],
	);

	const handleDeleteProvider = useCallback(
		async (name: string) => {
			if (!config) return;
			const newProviders = { ...config.providers };
			delete newProviders[name];
			const defaultModel = config.defaultModel?.startsWith(`${name}/`) ? undefined : config.defaultModel;
			await saveConfig({ ...config, defaultModel, providers: newProviders });
			if (expandedProvider === name) setExpandedProvider(null);
			recordSettingsUsage({ tab: "models", action: "deleted", target: "provider" });
		},
		[config, expandedProvider, saveConfig],
	);

	const startEditProvider = useCallback(
		(name: string) => {
			if (!config) return;
			const provider = config.providers[name];
			if (!provider) return;
			setProviderForm({
				name,
				baseUrl: provider.baseUrl || "",
				apiKey: provider.apiKey || "",
				api: provider.api || "openai-completions",
				headers: headersToString(provider.headers),
				authHeader: provider.authHeader ?? false,
			});
			setEditingProvider(name);
			setAddingProvider(false);
		},
		[config],
	);

	const handleAddModel = useCallback(
		async (providerName: string) => {
			if (!config || !modelForm.id.trim()) return;
			const provider = config.providers[providerName];
			if (!provider) return;
			const models = [...(provider.models || []), formToModelDef(modelForm)];
			await saveConfig({
				...config,
				providers: {
					...config.providers,
					[providerName]: { ...provider, models },
				},
			});
			setAddingModelFor(null);
			setModelForm({ ...emptyModel });
			recordSettingsUsage({
				tab: "models",
				action: "added",
				target: "model",
				value: modelForm.api || "provider-default",
			});
		},
		[config, modelForm, saveConfig],
	);

	const handleUpdateModel = useCallback(
		async (providerName: string, oldModelId: string) => {
			if (!config || !modelForm.id.trim()) return;
			const provider = config.providers[providerName];
			if (!provider) return;
			const models = (provider.models || []).map((model) =>
				model.id === oldModelId ? formToModelDef(modelForm) : model,
			);
			const oldKey = `${providerName}/${oldModelId}`;
			const newKey = `${providerName}/${modelForm.id.trim()}`;
			await saveConfig({
				...config,
				defaultModel: config.defaultModel === oldKey ? newKey : config.defaultModel,
				providers: {
					...config.providers,
					[providerName]: { ...provider, models },
				},
			});
			setEditingModel(null);
			setModelForm({ ...emptyModel });
			recordSettingsUsage({
				tab: "models",
				action: "updated",
				target: "model",
				value: modelForm.api || "provider-default",
			});
		},
		[config, modelForm, saveConfig],
	);

	const handleDeleteModel = useCallback(
		async (providerName: string, modelId: string) => {
			if (!config) return;
			const provider = config.providers[providerName];
			if (!provider) return;
			const models = (provider.models || []).filter((model) => model.id !== modelId);
			const modelKey = `${providerName}/${modelId}`;
			await saveConfig({
				...config,
				defaultModel: config.defaultModel === modelKey ? undefined : config.defaultModel,
				providers: {
					...config.providers,
					[providerName]: { ...provider, models },
				},
			});
			recordSettingsUsage({ tab: "models", action: "deleted", target: "model" });
		},
		[config, saveConfig],
	);

	const handleSetDefaultModel = useCallback(
		async (providerName: string, modelId: string) => {
			if (!config) return;
			const modelKey = `${providerName}/${modelId}`;
			const newDefault = config.defaultModel === modelKey ? undefined : modelKey;
			await saveConfig({ ...config, defaultModel: newDefault });
			if (newDefault) {
				localStorage.setItem("vetta-selected-model", newDefault);
			}
			recordSettingsUsage({
				tab: "models",
				action: newDefault ? "selected" : "reset",
				target: "default-model",
			});
		},
		[config, saveConfig],
	);

	const startEditModel = useCallback(
		(providerName: string, modelId: string) => {
			if (!config) return;
			const provider = config.providers[providerName];
			if (!provider) return;
			const model = (provider.models || []).find((item) => item.id === modelId);
			if (!model) return;
			setModelForm(modelToForm(model));
			setEditingModel({ provider: providerName, modelId });
			setAddingModelFor(null);
		},
		[config],
	);

	const handleFetchProviderModels = useCallback(
		async (providerName: string) => {
			setFetchingModelsFor(providerName);
			try {
				const result = await window.vetta.models.fetchProviderModels(providerName);
				const existing = new Set((config?.providers[providerName]?.models || []).map((item) => item.id));
				setFetchedModels({
					provider: providerName,
					models: result.models,
					// 默认只勾选尚未添加的模型，避免重复项。
					selected: result.models.filter((id) => !existing.has(id)),
					error: result.error,
				});
			} finally {
				setFetchingModelsFor(null);
			}
		},
		[config],
	);

	const handleApplyFetchedModels = useCallback(
		async (providerName: string) => {
			if (!config || !fetchedModels || fetchedModels.provider !== providerName) return;
			const provider = config.providers[providerName];
			if (!provider) return;
			const existing = new Set((provider.models || []).map((item) => item.id));
			const added = fetchedModels.selected.filter((id) => !existing.has(id)).map((id) => ({ id }));
			if (added.length === 0) {
				setFetchedModels(null);
				return;
			}
			await saveConfig({
				...config,
				providers: {
					...config.providers,
					[providerName]: { ...provider, models: [...(provider.models || []), ...added] },
				},
			});
			setFetchedModels(null);
			recordSettingsUsage({ tab: "models", action: "added", target: "model", value: "fetched" });
		},
		[config, fetchedModels, saveConfig],
	);

	const providerNames = useMemo(
		() =>
			config ? Object.keys(config.providers).filter((name) => config.providers[name]?.source !== "template") : [],
		[config],
	);

	return {
		config,
		providerNames,
		expandedProvider,
		addingProvider,
		providerForm,
		editingProvider,
		addingModelFor,
		editingModel,
		modelForm,
		saving,
		fetchingModelsFor,
		fetchedModels,
		setProviderForm,
		setModelForm,
		saveConfig,
		onStartAddProvider: () => {
			setAddingProvider(true);
			setEditingProvider(null);
			setProviderForm({ ...emptyProvider });
		},
		onCancelAddProvider: () => {
			setAddingProvider(false);
			setProviderForm({ ...emptyProvider });
		},
		onAddProvider: handleAddProvider,
		onStartEditProvider: startEditProvider,
		onCancelEditProvider: () => {
			setEditingProvider(null);
			setProviderForm({ ...emptyProvider });
		},
		onUpdateProvider: handleUpdateProvider,
		onDeleteProvider: handleDeleteProvider,
		onToggleProvider: (name: string) => setExpandedProvider(expandedProvider === name ? null : name),
		onStartAddModel: (providerName: string) => {
			setAddingModelFor(providerName);
			setEditingModel(null);
			setModelForm({ ...emptyModel });
		},
		onCancelAddModel: () => {
			setAddingModelFor(null);
			setModelForm({ ...emptyModel });
		},
		onAddModel: handleAddModel,
		onStartEditModel: startEditModel,
		onCancelEditModel: () => {
			setEditingModel(null);
			setModelForm({ ...emptyModel });
		},
		onUpdateModel: handleUpdateModel,
		onDeleteModel: handleDeleteModel,
		onSetDefaultModel: handleSetDefaultModel,
		onFetchProviderModels: handleFetchProviderModels,
		onToggleFetchedModel: (modelId: string) =>
			setFetchedModels((prev) =>
				prev
					? {
							...prev,
							selected: prev.selected.includes(modelId)
								? prev.selected.filter((id) => id !== modelId)
								: [...prev.selected, modelId],
						}
					: prev,
			),
		onCancelFetchedModels: () => setFetchedModels(null),
		onApplyFetchedModels: handleApplyFetchedModels,
	};
}

function parseHeadersString(value: string): Record<string, string> | undefined {
	const lines = value
		.trim()
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return undefined;
	return Object.fromEntries(
		lines.map((line) => {
			const idx = line.indexOf(":");
			return idx > 0 ? [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] : [line, ""];
		}),
	);
}

function headersToString(headers?: Record<string, string>): string {
	if (!headers) return "";
	return Object.entries(headers)
		.map(([key, value]) => `${key}: ${value}`)
		.join("\n");
}

function modelToForm(model: ModelEntry): ModelFormState {
	return {
		id: model.id,
		name: model.name || "",
		api: model.api || "",
		reasoning: model.reasoning ?? false,
		reasoningLevels: model.reasoningLevels ?? [],
		defaultReasoningLevel: model.defaultReasoningLevel ?? "",
		input: model.input ?? ["text"],
		contextWindow: model.contextWindow != null ? String(model.contextWindow) : "",
		maxTokens: model.maxTokens != null ? String(model.maxTokens) : "",
	};
}

function formToModelDef(form: ModelFormState): ModelEntry {
	const model: ModelEntry = {
		id: form.id.trim(),
	};
	if (form.name.trim()) model.name = form.name.trim();
	if (form.api) model.api = form.api;
	if (form.reasoning) {
		model.reasoning = true;
		if (form.reasoningLevels.length > 0) {
			model.reasoningLevels = form.reasoningLevels;
			if (form.defaultReasoningLevel) model.defaultReasoningLevel = form.defaultReasoningLevel;
		}
	}
	if (form.input.length > 0) model.input = form.input;
	const contextWindow = Number(form.contextWindow.trim());
	if (contextWindow > 0) model.contextWindow = contextWindow;
	const maxTokens = Number(form.maxTokens.trim());
	if (maxTokens > 0) model.maxTokens = maxTokens;
	return model;
}
