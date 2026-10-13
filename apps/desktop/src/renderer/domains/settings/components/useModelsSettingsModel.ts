import type { FetchedProviderModel, ModelsConfigData } from "@preload/api.js";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { localModelsConfigAtom, modelCatalog } from "@shared/store/model-catalog";
import { showToast } from "@shared/store/toast-atoms";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { deselectModels, filterFetchedModels, selectModels, toggleModelSelection } from "./fetched-models";
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

/** 单个候选模型的连通性测试结果。 */
export interface FetchedModelTestState {
	status: "testing" | "ok" | "fail";
	/** 成功时是主进程给的说明，失败时是原因，用于行内提示。 */
	message?: string;
}

/**
 * 「从 /models 接口拉取」抽屉状态。
 *
 * `models` 是接口返回的全部候选，`selected` 是用户勾选的 id，`search` 只影响可见列表——
 * 全选/全不选按可见范围生效，被搜索筛掉的勾选状态原样保留。
 */
export interface FetchedModelsState {
	provider: string;
	status: "loading" | "ready" | "error";
	models: FetchedProviderModel[];
	selected: string[];
	search: string;
	tests: Record<string, FetchedModelTestState>;
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
	/** 正在拉取的 provider，供服务商行显示 loading 并禁用按钮。 */
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
	onCopyProviderApiKey: (name: string) => Promise<void>;
	onToggleProvider: (name: string) => void;
	onStartAddModel: (providerName: string) => void;
	onCancelAddModel: () => void;
	onAddModel: (providerName: string) => Promise<void>;
	onStartEditModel: (providerName: string, modelId: string) => void;
	onCancelEditModel: () => void;
	onUpdateModel: (providerName: string, oldModelId: string) => Promise<void>;
	onDeleteModel: (providerName: string, modelId: string) => Promise<void>;
	onSetDefaultModel: (providerName: string, modelId: string) => Promise<void>;
	/** 点击「从接口拉取」：先同步打开抽屉，再拉取，不在点击处等待网络。 */
	onStartFetchProviderModels: (providerName: string) => void;
	onRetryFetchProviderModels: () => void;
	onFetchedModelsSearchChange: (query: string) => void;
	onToggleFetchedModel: (modelId: string) => void;
	onSelectAllFetchedModels: () => void;
	onDeselectAllFetchedModels: () => void;
	onTestFetchedModel: (modelId: string) => void;
	onCancelFetchedModels: () => void;
	onApplyFetchedModels: (providerName: string) => Promise<void>;
	/** 清空该服务商下全部模型（默认模型若属于它一并取消）；二次确认由 UI 层负责。 */
	onClearProviderModels: (providerName: string) => void;
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
	"openai-completions-deepseek",
	"zai-openai-completions",
	"zhipu-openai-completions",
].map((api) => ({ value: api, label: api }));

/**
 * 模型级 API 类型下拉的选项：
 * - 空串表示「继承服务商」，是模型 api 未显式设置时的语义；
 * - `Api` 类型对自定义值开放，配置里可能出现内置列表之外的 api，
 *   保留当前值作为额外选项，避免打开表单就被下拉悄悄改写。
 */
export function buildModelApiOptions(currentApi: string, inheritLabel: string): { value: string; label: string }[] {
	const options = [{ value: "", label: inheritLabel }, ...API_OPTIONS];
	const current = currentApi.trim();
	if (current && !options.some((option) => option.value === current)) {
		options.push({ value: current, label: current });
	}
	return options;
}

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
	const { t } = useTranslation("settings");
	// 与所有模型选择器共用同一份本地配置：这里保存后，已挂载的 popover 立刻同步。
	const config = useAtomValue(localModelsConfigAtom);
	const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
	const [addingProvider, setAddingProvider] = useState(false);
	const [providerForm, setProviderForm] = useState<ProviderFormState>({ ...emptyProvider });
	const [editingProvider, setEditingProvider] = useState<string | null>(null);
	const [addingModelFor, setAddingModelFor] = useState<string | null>(null);
	const [editingModel, setEditingModel] = useState<EditingModelState | null>(null);
	const [modelForm, setModelForm] = useState<ModelFormState>({ ...emptyModel });
	const [saving, setSaving] = useState(false);
	const [fetchedModels, setFetchedModels] = useState<FetchedModelsState | null>(null);

	useEffect(() => {
		void modelCatalog.revalidate({ sources: ["local"] });
	}, []);

	const saveConfig = useCallback(async (newConfig: ModelsConfigData) => {
		setSaving(true);
		try {
			await window.vetta.models.set(newConfig);
			// 刚写过盘，必须绕开 TTL 重新读回主进程规范化后的结果。
			await modelCatalog.revalidate({ force: true, sources: ["local"] });
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

			const providerData = providerFormToData();
			if (!providerData.apiKey && existing.apiKey) providerData.apiKey = existing.apiKey;
			newProviders[nextName] = {
				...existing,
				...providerData,
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

	/** 清空某服务商的全部模型；二次确认由「清空模型」按钮所在行负责，这里只执行。 */
	const clearProviderModels = useCallback(
		(name: string) => {
			if (!config) return;
			const current = config.providers[name];
			if (!current || (current.models || []).length === 0) return;
			void (async () => {
				await saveConfig({
					...config,
					defaultModel: config.defaultModel?.startsWith(`${name}/`) ? undefined : config.defaultModel,
					providers: {
						...config.providers,
						[name]: { ...current, models: [] },
					},
				});
				recordSettingsUsage({ tab: "models", action: "deleted", target: "model", value: "cleared" });
			})();
		},
		[config, saveConfig],
	);
	const startEditProvider = useCallback(
		(name: string) => {
			if (!config) return;
			const provider = config.providers[name];
			if (!provider) return;
			setProviderForm({
				name,
				baseUrl: provider.baseUrl || "",
				apiKey: "",
				api: provider.api || "openai-completions",
				headers: headersToString(provider.headers),
				authHeader: provider.authHeader ?? false,
			});
			setEditingProvider(name);
			setAddingProvider(false);
		},
		[config],
	);

	const handleCopyProviderApiKey = useCallback(
		async (name: string): Promise<void> => {
			try {
				const copied = await window.vetta.models.copyApiKey(name);
				showToast({
					variant: copied ? "success" : "error",
					message: t(copied ? "apiKeyCopied" : "apiKeyCopyFailed"),
				});
			} catch {
				showToast({ variant: "error", message: t("apiKeyCopyFailed") });
			}
		},
		[t],
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

	// 「从接口拉取」抽屉：先同步挂上 loading 状态让抽屉立即出现，等抽屉与加载态绘制完
	// 再去读接口，点击处不等待网络（见 docs/ui-first-async-work.md）。
	const loadFetchedModels = useCallback(async (providerName: string) => {
		await waitForCommittedPaint();
		const patch = (next: Partial<FetchedModelsState>): void =>
			setFetchedModels((prev) => (prev?.provider === providerName ? { ...prev, ...next } : prev));
		try {
			const result = await window.vetta.models.fetchProviderModels(providerName);
			patch({ status: result.error ? "error" : "ready", models: result.models, error: result.error });
		} catch (err) {
			patch({ status: "error", models: [], error: err instanceof Error ? err.message : String(err) });
		}
	}, []);

	const handleStartFetchProviderModels = useCallback(
		(providerName: string) => {
			setFetchedModels({
				provider: providerName,
				status: "loading",
				models: [],
				selected: [],
				search: "",
				tests: {},
			});
			void loadFetchedModels(providerName);
		},
		[loadFetchedModels],
	);

	const handleRetryFetchProviderModels = useCallback(() => {
		const providerName = fetchedModels?.provider;
		if (!providerName) return;
		setFetchedModels((prev) => (prev ? { ...prev, status: "loading", error: undefined } : prev));
		void loadFetchedModels(providerName);
	}, [fetchedModels?.provider, loadFetchedModels]);

	const handleTestFetchedModel = useCallback(
		async (modelId: string) => {
			const state = fetchedModels;
			if (!state || state.tests[modelId]?.status === "testing") return;
			const { provider } = state;
			const patchTest = (test: FetchedModelTestState): void =>
				setFetchedModels((prev) =>
					prev?.provider === provider ? { ...prev, tests: { ...prev.tests, [modelId]: test } } : prev,
				);

			patchTest({ status: "testing" });
			try {
				// 复用既有的「测试连通」语义：只判 baseUrl 可达，不发真实推理请求。
				const result = await window.vetta.models.probe({ provider, model: modelId });
				patchTest({ status: result.ok ? "ok" : "fail", message: result.ok ? result.message : result.error });
			} catch (err) {
				patchTest({ status: "fail", message: err instanceof Error ? err.message : String(err) });
			}
		},
		[fetchedModels],
	);

	const handleApplyFetchedModels = useCallback(
		async (providerName: string) => {
			if (!config || !fetchedModels || fetchedModels.provider !== providerName) return;
			const provider = config.providers[providerName];
			if (!provider) return;
			const existing = new Set((provider.models || []).map((item) => item.id));
			// 接口返回的参数（上下文、最大输出、输入能力、是否支持思考）随模型一起落盘。
			const fetchedById = new Map(fetchedModels.models.map((item) => [item.id, item]));
			const added = fetchedModels.selected
				.filter((id) => !existing.has(id))
				.map((id) => fetchedModelToDefinition(fetchedById.get(id) ?? { id }));
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
		fetchingModelsFor: fetchedModels?.status === "loading" ? fetchedModels.provider : null,
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
		onClearProviderModels: clearProviderModels,
		onCopyProviderApiKey: handleCopyProviderApiKey,
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
		onStartFetchProviderModels: handleStartFetchProviderModels,
		onRetryFetchProviderModels: handleRetryFetchProviderModels,
		onFetchedModelsSearchChange: (query: string) =>
			setFetchedModels((prev) => (prev ? { ...prev, search: query } : prev)),
		onToggleFetchedModel: (modelId: string) =>
			setFetchedModels((prev) =>
				prev ? { ...prev, selected: toggleModelSelection(prev.selected, modelId) } : prev,
			),
		onSelectAllFetchedModels: () =>
			setFetchedModels((prev) => {
				if (!prev) return prev;
				// 已添加的模型勾选了也不会重复写入，全选只覆盖尚未添加的可见项，计数才准确。
				const existing = new Set((config?.providers[prev.provider]?.models || []).map((item) => item.id));
				const selectable = filterFetchedModels(prev.models, prev.search)
					.filter((model) => !existing.has(model.id))
					.map((model) => model.id);
				return { ...prev, selected: selectModels(prev.selected, selectable) };
			}),
		onDeselectAllFetchedModels: () =>
			setFetchedModels((prev) =>
				prev
					? {
							...prev,
							selected: deselectModels(
								prev.selected,
								filterFetchedModels(prev.models, prev.search).map((model) => model.id),
							),
						}
					: prev,
			),
		onTestFetchedModel: (modelId: string) => void handleTestFetchedModel(modelId),
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

/**
 * 「从接口拉取」勾中的候选转成模型配置，与「预设服务商」同步同一个口径：
 * 上游明确说了的参数才写，没说的一律不猜；思考档位写模型自己声明的，默认档位不写，
 * 交给运行时按声明顺序取首个（与目录同步的处理一致）。
 */
function fetchedModelToDefinition(model: FetchedProviderModel): ModelEntry {
	const definition: ModelEntry = {
		id: model.id,
		input: model.vision ? ["text", "image"] : ["text"],
	};
	if (model.name) definition.name = model.name;
	if (model.reasoning || model.reasoningLevels?.length) definition.reasoning = true;
	if (model.reasoningLevels?.length) definition.reasoningLevels = [...model.reasoningLevels];
	if (model.contextWindow) definition.contextWindow = model.contextWindow;
	if (model.maxTokens) definition.maxTokens = model.maxTokens;
	return definition;
}
