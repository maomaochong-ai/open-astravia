import type { InstalledPlugin } from "@preload/api";
import { agentModeAtom } from "@shared/store/atoms";
import type { PluginContext, PluginSettingsApi } from "@vetta-org/plugin-sdk";
import { getDefaultStore } from "jotai";
import { createPluginAgentApi, createPluginAppActionsApi } from "./plugin-agent-context";
import { createPluginAiApi } from "./plugin-ai";
import { createPluginFileExplorerApi } from "./plugin-file-explorer-context";
import {
	createArtifactsApi,
	createCaptureApi,
	createCommandApi,
	createConversationApi,
	createFsApi,
	createGatewayApi,
	createI18nApi,
	createJobsApi,
	createMediaApi,
	createNetworkApi,
	createStorageApi,
} from "./plugin-host-apis";
import type { PluginLocalContributions } from "./plugin-local-contributions";
import { createPluginOfficialApi } from "./plugin-official-api";
import { createPluginPermissionApi as createPermissionApi } from "./plugin-permissions";
import { createPluginUiApi } from "./plugin-ui-context";

export interface CreatePluginContextOptions {
	plugin: InstalledPlugin;
	contributions: PluginLocalContributions;
	settingsApi: PluginSettingsApi;
	onChanged: () => void;
	disposers: Array<() => void>;
	pendingRuntimeRegistrations: Promise<void>[];
	activationId: string;
	capabilitySessionId: string;
}

export function createPluginContext({
	plugin,
	contributions,
	settingsApi,
	onChanged,
	disposers,
	pendingRuntimeRegistrations,
	activationId,
	capabilitySessionId,
}: CreatePluginContextOptions): PluginContext {
	const { toolCallSlots } = contributions;
	/**
	 * 已注册的 agent 工具负载，按 toolName 索引。用于「工具先注册、自渲染槽后注册」时回补
	 * `rendersCard`——同一次激活内两者顺序不固定，靠重推让状态收敛（主进程按 tool.id 覆盖，幂等）。
	 */
	const fs = createFsApi(plugin, capabilitySessionId);
	const conversation = createConversationApi(plugin);
	const agentContributions = createPluginAgentApi({
		plugin,
		activationId,
		fs,
		conversation,
		toolCallSlots,
		pendingRuntimeRegistrations,
	});
	const ui = createPluginUiApi({
		plugin,
		contributions,
		onChanged,
		disposers,
		agentContributions,
		capabilitySessionId,
	});
	const permissions = createPermissionApi(plugin);
	return {
		plugin: {
			id: plugin.id,
			version: plugin.activeVersion,
			...(plugin.iconUrl ? { iconUrl: plugin.iconUrl } : {}),
		},
		permissions,
		ui,
		fileExplorer: createPluginFileExplorerApi({
			plugin,
			contributions,
			onChanged,
			disposers,
		}),
		conversation,
		fs,
		command: createCommandApi(plugin, capabilitySessionId, disposers),
		media: createMediaApi(plugin, capabilitySessionId, activationId, disposers, pendingRuntimeRegistrations),
		jobs: createJobsApi(plugin, capabilitySessionId),
		artifacts: createArtifactsApi(plugin, capabilitySessionId),
		capture: createCaptureApi(plugin, disposers),
		agent: agentContributions.api,
		appActions: createPluginAppActionsApi({
			plugin,
			activationId,
			disposers,
			pendingRuntimeRegistrations,
		}),
		ai: createPluginAiApi(permissions, capabilitySessionId),
		official: createPluginOfficialApi(capabilitySessionId),
		network: createNetworkApi(plugin, capabilitySessionId),
		gateway: plugin.trustLevel === "official" ? createGatewayApi(capabilitySessionId) : undefined,
		storage: createStorageApi(plugin, capabilitySessionId),
		settings: settingsApi,
		i18n: createI18nApi(plugin),
		getAgentMode: () => getDefaultStore().get(agentModeAtom),
		onAgentModeChanged: (listener) => {
			const store = getDefaultStore();
			const unsub = store.sub(agentModeAtom, () => listener(store.get(agentModeAtom)));
			return { dispose: unsub };
		},
	};
}
