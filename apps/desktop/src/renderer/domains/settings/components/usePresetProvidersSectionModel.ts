import type { ModelsConfigData, PresetError, PresetProviderInfo } from "@preload/api.js";
import { confirmDialogAtom } from "@shared/store/atoms";
import { showToast } from "@shared/store/toast-atoms";
import type { TFunction } from "i18next";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { isInvalidKey, translatePresetError } from "./translatePresetError";

type ProviderEntry = ModelsConfigData["providers"][string];
type ModelCost = { input: number; output: number; cacheRead: number; cacheWrite: number };
type CostLabelKey = "costInput" | "costCacheRead" | "costCacheWrite" | "costOutput";

export interface PresetProviderModelRow {
	id: string;
	name: string;
	contextWindow?: number;
	hasVision: boolean;
	hasReasoning: boolean;
	price: string | null;
}

export interface PresetProviderRow {
	id: string;
	displayName: string;
	api: string;
	baseUrl?: string;
	icon?: string;
	models: NonNullable<ProviderEntry["models"]>;
	modelRows: PresetProviderModelRow[];
	offline: boolean;
	adopted: boolean;
	/** 已采纳且未被暂停；徽标与开关都看这一个值。 */
	enabled: boolean;
	/** 本机回环代理：编辑区只开放端口。 */
	localProxy?: boolean;
	/** 已内置密钥默认值：空草稿即可启用。 */
	hasDefaultApiKey?: boolean;
	isOpen: boolean;
	isExpanded: boolean;
	refreshing: boolean;
	hasApiKey: boolean;
	/** 该行最近一次拉取模型失败的原因。 */
	modelsError: string | null;
}

export interface PresetProvidersSectionLabels {
	title: string;
	loading: string;
	noPresetProviders: string;
	enabled: string;
	deprecated: string;
	collapseModels: string;
	viewModels: string;
	modelsCount: (count: number) => string;
	collapse: string;
	cancel: string;
	changeKey: string;
	remove: string;
	enable: string;
	/** 行尾开关的无障碍名称，含服务商名便于区分。 */
	toggleProvider: (provider: string) => string;
	/** 本机代理改端口时的输入框名称。 */
	port: string;
	apiKeyDirect: (provider: string) => string;
	apiKeyPlaceholder: string;
	encryptedApiKeyPlaceholder: string;
	save: string;
	noModels: string;
	noMatchingModels: string;
	searchModels: (provider: string) => string;
	clearModelSearch: string;
	modelListLabel: (provider: string) => string;
	thinking: string;
	perMillionTokens: string;
	refreshModels: string;
	refreshingModels: string;
	refreshCatalog: string;
	copyApiKey: string;
}

export interface PresetProvidersSectionModel {
	rows: PresetProviderRow[];
	error: string | null;
	loading: boolean;
	/** Per-provider draft API keys (always-visible enable inputs need independent drafts). */
	draftKeys: Record<string, string>;
	saving: boolean;
	labels: PresetProvidersSectionLabels;
	onToggleExpanded: (row: PresetProviderRow) => void;
	onToggleEditor: (row: PresetProviderRow) => void;
	onDraftKeyChange: (rowId: string, key: string) => void;
	onAdopt: (row: PresetProviderRow) => Promise<void>;
	onRemove: (row: PresetProviderRow) => Promise<void>;
	/** 暂停 / 恢复一个已采纳的服务商：只翻 disabled，密钥与模型都保留。 */
	onToggleEnabled: (row: PresetProviderRow, enabled: boolean) => Promise<void>;
	/** 本机代理：改端口即重新启用，主机固定回环。 */
	onSetPort: (row: PresetProviderRow, port: string) => Promise<void>;
	onRefreshModels: (row: PresetProviderRow) => Promise<void>;
	onCopyApiKey: (row: PresetProviderRow) => Promise<void>;
	/** 手动重拉公共目录(models.dev)。 */
	refreshingCatalog: boolean;
	onRefreshCatalog: () => Promise<void>;
}

export function usePresetProvidersSectionModel({
	config,
	saveConfig,
}: {
	config: ModelsConfigData;
	saveConfig: (config: ModelsConfigData) => Promise<void>;
}): PresetProvidersSectionModel {
	const { t, i18n } = useTranslation("settings");
	const setConfirm = useSetAtom(confirmDialogAtom);
	const [presets, setPresets] = useState<PresetProviderInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/** Only used for adopted providers' "change key" panel. */
	const [openId, setOpenId] = useState<string | null>(null);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [draftKeys, setDraftKeys] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	const [refreshingId, setRefreshingId] = useState<string | null>(null);
	const [modelsErrors, setModelsErrors] = useState<Record<string, string>>({});
	const [refreshingCatalog, setRefreshingCatalog] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await window.astravia.models.listPresets();
			setPresets(result.providers);
			// 公共目录连缓存都没有时把原因摆出来,别让用户对着 0 个模型猜。
			if (result.catalogError) {
				console.error(
					`[preset-providers] models.dev 公共目录不可达，已退到随包快照（${result.catalogFetchedAt ?? "?"}）：`,
					result.catalogError,
				);
				const time = result.catalogFetchedAt ? formatSyncedAt(result.catalogFetchedAt, i18n.language) : "?";
				setError(`${t("catalogUnavailable", { time })} ${translatePresetError(result.catalogError, t)}`);
			} else {
				setError(null);
			}
		} catch {
			setError(t("fetchFailed"));
		} finally {
			setLoading(false);
		}
	}, [i18n.language, t]);

	useEffect(() => {
		void load();
		// 目录是后台刷新的:拉到新数据后重新列一遍,不必让用户手动重试。
		return window.astravia.models.onPresetsUpdated(() => void load());
	}, [load]);

	const rows = useMemo(() => {
		const presetIds = new Set(presets.map((preset) => preset.id));
		// 早期由服务端模板采纳、现已不在内置目录里的条目:保留展示,标记为已下线。
		const orphaned: BaseRow[] = Object.entries(config.providers)
			.filter(([id, provider]) => provider.source === "template" && !presetIds.has(id))
			.map(([id, provider]) => ({
				id,
				displayName: provider.displayName ?? id,
				api: provider.api ?? "",
				baseUrl: provider.baseUrl,
				icon: provider.icon,
				models: provider.models ?? [],
				offline: true,
			}));
		const presetRows: BaseRow[] = presets.map((preset) => ({
			id: preset.id,
			displayName: preset.displayName,
			api: preset.api,
			baseUrl: preset.baseUrl,
			icon: preset.icon,
			// 已启用的用账号实际可用的 /models 结果,未启用的展示 models.dev 公共目录。
			models: config.providers[preset.id]?.models ?? preset.catalogModels,
			offline: false,
			...(preset.localProxy ? { localProxy: true } : {}),
			...(preset.hasDefaultApiKey ? { hasDefaultApiKey: true } : {}),
		}));

		return [...presetRows, ...orphaned].map((row) => {
			const providerConfig = config.providers[row.id];
			const adopted = providerConfig?.source === "template";
			return {
				...row,
				modelRows: row.models.map((model) => toModelRow(model, t)),
				adopted,
				enabled: adopted && !providerConfig?.disabled,
				isOpen: openId === row.id,
				isExpanded: expandedId === row.id,
				refreshing: refreshingId === row.id,
				hasApiKey: Boolean(config.providers[row.id]?.apiKey),
				modelsError: modelsErrors[row.id] ?? null,
			};
		});
	}, [config.providers, expandedId, modelsErrors, openId, presets, refreshingId, t]);

	const handleToggleEditor = useCallback((row: PresetProviderRow): void => {
		if (row.isOpen) {
			setOpenId(null);
			return;
		}
		setOpenId(row.id);
		setDraftKeys((prev) => ({
			...prev,
			[row.id]: prev[row.id] ?? "",
		}));
	}, []);

	const handleToggleExpanded = useCallback((row: PresetProviderRow): void => {
		setExpandedId(row.isExpanded ? null : row.id);
	}, []);

	const handleDraftKeyChange = useCallback((rowId: string, key: string): void => {
		setDraftKeys((prev) => ({ ...prev, [rowId]: key }));
	}, []);

	const copyApiKey = useCallback(
		async (row: PresetProviderRow): Promise<void> => {
			try {
				const copied = await window.astravia.models.copyApiKey(row.id);
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

	const adoptPreset = useCallback(
		async (row: PresetProviderRow, overrides?: { baseUrl?: string }): Promise<void> => {
			const key = (draftKeys[row.id] ?? "").trim();
			// 内置了密钥默认值的预设（本机代理）不必先让用户造一个 key。
			if (!key && !row.hasDefaultApiKey) return;
			setSaving(true);
			try {
				// 填 key 即校验:拉不到模型一律不落盘、不启用。
				// 预设服务商全是云端 API,拉不通时启用它也没有任何模型可用;放行「非认证类失败」
				// 会让用户以为已生效,还得自己去发现它是个空壳。面板与草稿保留,改完再点一次即可。
				// 已下线的旧条目不在内置目录里,没有可校验的上游,只改 key 不校验。
				const fetched = row.offline ? null : await refreshModels(row.id, key);
				if (fetched && (fetched.error || fetched.models.length === 0)) {
					const error = fetched.error ?? { code: "empty-models" as const };
					notifyKeyRejected(row.displayName, error, t);
					setModelsErrors((prev) => withError(prev, row.id, error, t));
					return;
				}
				setModelsErrors((prev) => withError(prev, row.id, undefined, t));
				await saveConfig({
					...config,
					providers: {
						...config.providers,
						[row.id]: {
							source: "template",
							templateId: row.id,
							displayName: row.displayName,
							icon: row.icon,
							api: row.api,
							baseUrl: overrides?.baseUrl ?? row.baseUrl,
							apiKey: key,
							models: fetched?.models ?? row.models,
							...(fetched ? { modelsSyncedAt: new Date().toISOString() } : {}),
						},
					},
				});
				setOpenId((current) => (current === row.id ? null : current));
				setDraftKeys((prev) => {
					const next = { ...prev };
					delete next[row.id];
					return next;
				});
			} finally {
				setSaving(false);
			}
		},
		[config, draftKeys, saveConfig, t],
	);

	const adopt = useCallback((row: PresetProviderRow): Promise<void> => adoptPreset(row), [adoptPreset]);

	/**
	 * 本机代理只开放端口：主机固定回环，端口越界或非数字一律不落盘。
	 * 复用采纳流程，把它当作「以新地址重新启用」，因此也会重新拉一次模型清单。
	 */
	const setPresetPort = useCallback(
		async (row: PresetProviderRow, rawPort: string): Promise<void> => {
			const port = Number(rawPort.trim());
			if (!Number.isInteger(port) || port < 1 || port > 65535) {
				showToast({ variant: "error", title: t("invalidPort"), message: t("invalidPortHint") });
				return;
			}
			await adoptPreset(row, { baseUrl: `http://127.0.0.1:${port}/v1` });
		},
		[adoptPreset, t],
	);

	const refresh = useCallback(
		async (row: PresetProviderRow): Promise<void> => {
			const provider = config.providers[row.id];
			if (!provider?.apiKey) return;
			setRefreshingId(row.id);
			try {
				const result = await refreshModels(row.id);
				setModelsErrors((prev) => withError(prev, row.id, result.error, t));
				if (result.error) {
					notifyPresetError(row.displayName, result.error, t);
				}
				if (result.models.length === 0) return;
				await saveConfig({
					...config,
					providers: {
						...config.providers,
						[row.id]: { ...provider, models: result.models, modelsSyncedAt: new Date().toISOString() },
					},
				});
			} finally {
				setRefreshingId(null);
			}
		},
		[config, saveConfig, t],
	);

	/** 手动重拉公共目录:清冷却强制重试,失败把原文打进控制台并显示出来。 */
	const refreshCatalog = useCallback(async (): Promise<void> => {
		setRefreshingCatalog(true);
		try {
			const result = await window.astravia.models.refreshPresetCatalog();
			if (result.ok) {
				console.info(
					`[preset-providers] models.dev 目录已更新，共 ${result.modelCount} 个模型（${result.elapsedMs}ms）`,
				);
				showToast({
					variant: "success",
					message: t("catalogRefreshed", { count: result.modelCount }),
				});
			} else {
				console.error("[preset-providers] 刷新 models.dev 目录失败：", result.error);
				showToast({
					variant: "error",
					title: t("catalogRefreshFailed"),
					message: translatePresetError(result.error ?? { code: "network" }, t),
					durationMs: 8000,
				});
			}
			await load();
		} catch (err) {
			console.error("[preset-providers] 刷新 models.dev 目录异常：", err);
			showToast({
				variant: "error",
				title: t("catalogRefreshFailed"),
				message: translatePresetError({ code: "network", detail: String(err) }, t),
				durationMs: 8000,
			});
		} finally {
			setRefreshingCatalog(false);
		}
	}, [load, t]);

	const performRemove = useCallback(
		async (row: PresetProviderRow): Promise<void> => {
			const providers = { ...config.providers };
			delete providers[row.id];
			const defaultModel = config.defaultModel?.startsWith(`${row.id}/`) ? undefined : config.defaultModel;
			await saveConfig({ ...config, defaultModel, providers });
			if (openId === row.id) setOpenId(null);
			setModelsErrors((prev) => withError(prev, row.id, undefined, t));
			setDraftKeys((prev) => {
				if (!(row.id in prev)) return prev;
				const next = { ...prev };
				delete next[row.id];
				return next;
			});
		},
		[config, openId, saveConfig, t],
	);

	// 移除会连同本地保存的 Key 和模型配置一起删掉，且无法撤销，所以先二次确认；
	// 真正执行放在确认回调里，点「取消」什么都不会发生。
	const toggleEnabled = useCallback(
		async (row: PresetProviderRow, enabled: boolean): Promise<void> => {
			const provider = config.providers[row.id];
			// 未采纳的走「启用」流程（填 key）；只有已采纳的才有暂停语义。
			if (provider?.source !== "template") return;
			const providers = {
				...config.providers,
				[row.id]: { ...provider, disabled: enabled ? undefined : true },
			};
			// 暂停的正是默认模型所属服务商时，默认一并清掉，避免新会话挑一个关掉的提供方。
			const defaultModel =
				!enabled && config.defaultModel?.startsWith(`${row.id}/`) ? undefined : config.defaultModel;
			await saveConfig({ ...config, defaultModel, providers });
		},
		[config, saveConfig],
	);

	const remove = useCallback(
		(row: PresetProviderRow): Promise<void> => {
			setConfirm({
				title: t("removeProviderTitle", { provider: row.displayName }),
				message: t("removeProviderConfirm", { provider: row.displayName }),
				confirmLabel: t("remove"),
				variant: "danger",
				onConfirm: () => {
					void performRemove(row);
				},
			});
			return Promise.resolve();
		},
		[performRemove, setConfirm, t],
	);

	return {
		rows,
		error,
		loading,
		draftKeys,
		saving,
		labels: {
			title: t("presetProviders"),
			loading: t("loading"),
			noPresetProviders: t("noPresetProviders"),
			enabled: t("enabled"),
			deprecated: t("deprecated"),
			collapseModels: t("collapseModels"),
			viewModels: t("viewModels"),
			modelsCount: (count: number) => t("modelsCount", { count }),
			collapse: t("collapse"),
			cancel: t("cancel"),
			changeKey: t("changeKey"),
			remove: t("remove"),
			enable: t("enable"),
			port: t("port"),
			toggleProvider: (provider: string) => t("toggleProvider", { provider }),
			apiKeyDirect: (provider: string) => t("apiKeyDirect", { provider }),
			apiKeyPlaceholder: t("presetApiKeyPlaceholder"),
			encryptedApiKeyPlaceholder: t("replaceApiKeyPlaceholder"),
			save: t("save"),
			noModels: t("noModels"),
			noMatchingModels: t("noMatchingModels"),
			searchModels: (provider: string) => t("searchModels", { provider }),
			clearModelSearch: t("clearModelSearch"),
			modelListLabel: (provider: string) => t("modelListLabel", { provider }),
			thinking: t("thinking"),
			perMillionTokens: t("perMillionTokens"),
			refreshModels: t("refreshModels"),
			refreshingModels: t("refreshingModels"),
			refreshCatalog: t("refreshCatalog"),
			copyApiKey: t("copyApiKey"),
		},
		onToggleExpanded: handleToggleExpanded,
		onToggleEditor: handleToggleEditor,
		onDraftKeyChange: handleDraftKeyChange,
		onAdopt: adopt,
		onRemove: remove,
		onToggleEnabled: toggleEnabled,
		onSetPort: setPresetPort,
		onRefreshModels: refresh,
		onCopyApiKey: copyApiKey,
		refreshingCatalog,
		onRefreshCatalog: refreshCatalog,
	};
}

function toModelRow(
	model: NonNullable<ProviderEntry["models"]>[number],
	t: TFunction<"settings">,
): PresetProviderModelRow {
	return {
		id: model.id,
		name: model.name || model.id,
		contextWindow: model.contextWindow,
		hasVision: model.input?.includes("image") ?? false,
		hasReasoning: Boolean(model.reasoning),
		price: formatPrice(model.cost, t),
	};
}

interface BaseRow {
	id: string;
	displayName: string;
	api: string;
	baseUrl?: string;
	icon?: string;
	models: NonNullable<ProviderEntry["models"]>;
	offline: boolean;
	/** 本机回环代理：地址只开放端口修改。 */
	localProxy?: boolean;
	/** 已内置密钥默认值：一键启用时不必先让用户填 key。 */
	hasDefaultApiKey?: boolean;
}

async function refreshModels(
	providerId: string,
	apiKey?: string,
): Promise<{ models: NonNullable<ProviderEntry["models"]>; error?: PresetError }> {
	try {
		return await window.astravia.models.refreshPresetModels(providerId, apiKey);
	} catch (err) {
		return { models: [], error: { code: "network", detail: err instanceof Error ? err.message : String(err) } };
	}
}

/** 错误既进行内提示,也进全局通知——设置页可能已经滚走了,行内那行字看不见。 */
function notifyPresetError(provider: string, error: PresetError, t: TFunction<"settings">): void {
	// 密钥被拒是最常见也最需要一眼认出的失败,不能淹没在笼统的「拉取失败」标题里。
	const title = isInvalidKey(error) ? t("keyRejected", { provider }) : t("modelsRefreshFailed", { provider });
	showToast({ variant: "error", title, message: translatePresetError(error, t), durationMs: 8000 });
}

/** 启用被挡下时的提示。必须说清「没保存」,否则用户会以为已经生效。 */
function notifyKeyRejected(provider: string, error: PresetError, t: TFunction<"settings">): void {
	showToast({
		variant: "error",
		title: isInvalidKey(error) ? t("keyRejected", { provider }) : t("keyNotVerified", { provider }),
		message: `${translatePresetError(error, t)} ${t("keyRejectedHint")}`,
		durationMs: 8000,
	});
}

function withError(
	prev: Record<string, string>,
	id: string,
	error: PresetError | undefined,
	t: TFunction<"settings">,
): Record<string, string> {
	if (error) return { ...prev, [id]: translatePresetError(error, t) };
	if (!(id in prev)) return prev;
	const next = { ...prev };
	delete next[id];
	return next;
}

function formatSyncedAt(iso: string, locale: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
}

function formatPrice(cost: ModelCost | undefined, t: (key: CostLabelKey) => string): string | null {
	if (!cost) return null;
	const num = (n: number) => (Number.isInteger(n) ? String(n) : parseFloat(n.toFixed(6)).toString());
	const parts: string[] = [];
	if (cost.input) parts.push(`${t("costInput")} $${num(cost.input)}`);
	if (cost.cacheRead) parts.push(`${t("costCacheRead")} $${num(cost.cacheRead)}`);
	if (cost.cacheWrite) parts.push(`${t("costCacheWrite")} $${num(cost.cacheWrite)}`);
	if (cost.output) parts.push(`${t("costOutput")} $${num(cost.output)}`);
	if (parts.length === 0) return null;
	return parts.join(" · ");
}
