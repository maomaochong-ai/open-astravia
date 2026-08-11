import { remoteProvidersAtom } from "@shared/store/atoms";
import type {
	PluginOfficialApi,
	PluginOfficialModelSummary,
	PluginOfficialProviderSummary,
} from "@vetta-org/plugin-sdk";
import { getDefaultStore } from "jotai";

/**
 * 宿主的可选模型有**两个来源**：主进程的 `models.json`（用户自配的 provider）和
 * 登录后服务端下发的远程目录（Vetta Go 等，只存在于 renderer 内存）。主进程那侧
 * 看不见远程目录，所以 `list` / `assertModelKeyExists` 必须在这里把两份合起来，
 * 否则插件拿到的模型清单会比用户在输入栏里看到的少一整块。
 *
 * 合并口径与宿主模型选择器（useModelOptions）保持一致：同一个 `provider/modelId`
 * 以本地为准，远程只补本地没有的。
 */

interface RemoteModelEntry {
	id: string;
	name?: string;
	api?: string;
	reasoning?: boolean;
}

interface RemoteProviderEntry {
	displayName?: string;
	api?: string;
	baseUrl?: string;
	models?: RemoteModelEntry[];
}

function asRemoteProvider(value: unknown): RemoteProviderEntry | null {
	if (value == null || typeof value !== "object") return null;
	return value as RemoteProviderEntry;
}

function remoteModels(entry: RemoteProviderEntry): PluginOfficialModelSummary[] {
	const models = Array.isArray(entry.models) ? entry.models : [];
	return models
		.filter((model): model is RemoteModelEntry => typeof model?.id === "string" && model.id.length > 0)
		.map((model) => ({
			id: model.id,
			...(model.name ? { name: model.name } : {}),
			...((model.api ?? entry.api) ? { api: model.api ?? entry.api } : {}),
			...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
		}));
}

/** 远程目录的 provider 摘要；`hasApiKey` 为 true——它的凭据是登录态，未登录时这份目录本就是空的。 */
function readRemoteProviders(): PluginOfficialProviderSummary[] {
	const raw = getDefaultStore().get(remoteProvidersAtom);
	return Object.entries(raw).flatMap(([id, value]) => {
		const entry = asRemoteProvider(value);
		if (!entry) return [];
		const models = remoteModels(entry);
		return [
			{
				id,
				// 与宿主选择器同一套兜底：远程目录没给显示名时，vetta-go 有专名，其余回落 provider id。
				displayName: entry.displayName ?? (id === "vetta-go" ? "Vetta Go" : id),
				...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
				...(entry.api ? { api: entry.api } : {}),
				hasApiKey: true,
				remote: true,
				modelCount: models.length,
				models,
			},
		];
	});
}

/** 本地优先合并：provider 同名时保留本地摘要，只补进本地没有的模型。 */
function mergeProviders(
	local: PluginOfficialProviderSummary[],
	remote: PluginOfficialProviderSummary[],
): PluginOfficialProviderSummary[] {
	const byId = new Map(local.map((provider) => [provider.id, provider]));
	const merged = [...local];
	for (const provider of remote) {
		const existing = byId.get(provider.id);
		if (!existing) {
			merged.push(provider);
			continue;
		}
		const localModelIds = new Set(existing.models.map((model) => model.id));
		const extra = provider.models.filter((model) => !localModelIds.has(model.id));
		if (extra.length === 0) continue;
		const models = [...existing.models, ...extra];
		merged[merged.indexOf(existing)] = { ...existing, models, modelCount: models.length };
	}
	return merged;
}

function remoteHasModelKey(modelKey: string): boolean {
	const slash = modelKey.indexOf("/");
	if (slash <= 0) return false;
	const providerId = modelKey.slice(0, slash);
	const modelId = modelKey.slice(slash + 1);
	const entry = asRemoteProvider(getDefaultStore().get(remoteProvidersAtom)[providerId]);
	return entry !== null && remoteModels(entry).some((model) => model.id === modelId);
}

export function createOfficialModelsApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["models"] {
	const models = window.vetta.plugins.internalCapabilities.models;
	const listMerged = async (): Promise<{
		defaultModel: string | null;
		providers: PluginOfficialProviderSummary[];
	}> => {
		const local = await models.list(capabilitySessionId);
		return { ...local, providers: mergeProviders(local.providers, readRemoteProviders()) };
	};
	return {
		list: async () => {
			assertOfficial();
			return listMerged();
		},
		get: async (provider) => {
			assertOfficial();
			return provider ? models.getProvider(capabilitySessionId, provider) : models.getConfig(capabilitySessionId);
		},
		probe: async (provider, model) => {
			assertOfficial();
			return models.probe(capabilitySessionId, provider, model);
		},
		listProviderIds: async () => {
			assertOfficial();
			return (await listMerged()).providers.map((provider) => provider.id);
		},
		assertModelKeyExists: async (modelKey, operation) => {
			assertOfficial();
			// 远程目录里的模型（Vetta Go）主进程不认识，先在本地内存这份里认一次再落回主进程校验。
			if (remoteHasModelKey(modelKey)) return;
			await models.validateModelKey(capabilitySessionId, modelKey, operation);
		},
		setDefault: async (modelKey) => {
			assertOfficial();
			return models.setDefault(capabilitySessionId, modelKey);
		},
		upsertProvider: async (provider, data) => {
			assertOfficial();
			return models.upsertProvider(capabilitySessionId, provider, data);
		},
		removeProvider: async (provider) => {
			assertOfficial();
			await models.removeProvider(capabilitySessionId, provider);
		},
	};
}
