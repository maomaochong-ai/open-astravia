import { ipcMain, webContents } from "electron";
import { PLUGIN_CONTRIBUTION_CHANNELS } from "../../shared/plugin-ipc.js";
import { getAppLogger } from "../logger.js";
import type { PluginActionService } from "../plugins/plugin-action-service.js";
import { getPluginSettings, pluginAgentContributionService, setPluginSettings } from "../plugins/plugin-catalog.js";
import { refreshAgentPlugins } from "../plugins/plugin-runtime-service.js";
import {
	asAgentHookRegistration,
	asAgentToolRegistration,
	asAppActionRegistration,
	asContinuationRegistration,
	asOptionalStringId,
	asPluginId,
	asSystemPromptProviderRegistration,
} from "./plugin-input-parsers.js";

const pluginLog = getAppLogger("plugin");
const handlerChannels = [
	PLUGIN_CONTRIBUTION_CHANNELS.BEGIN_LOAD,
	PLUGIN_CONTRIBUTION_CHANNELS.TOOL_REGISTER,
	PLUGIN_CONTRIBUTION_CHANNELS.TOOL_UNREGISTER,
	PLUGIN_CONTRIBUTION_CHANNELS.HOOK_REGISTER,
	PLUGIN_CONTRIBUTION_CHANNELS.HOOK_UNREGISTER,
	PLUGIN_CONTRIBUTION_CHANNELS.CLEAR,
	PLUGIN_CONTRIBUTION_CHANNELS.APP_ACTION_REGISTER,
	PLUGIN_CONTRIBUTION_CHANNELS.APP_ACTION_COMMIT,
	PLUGIN_CONTRIBUTION_CHANNELS.APP_ACTION_ABORT,
	PLUGIN_CONTRIBUTION_CHANNELS.APP_ACTION_UNREGISTER,
	PLUGIN_CONTRIBUTION_CHANNELS.APP_ACTION_RESPONSE,
	PLUGIN_CONTRIBUTION_CHANNELS.CONTINUATION_REGISTER,
	PLUGIN_CONTRIBUTION_CHANNELS.CONTINUATION_UNREGISTER,
	PLUGIN_CONTRIBUTION_CHANNELS.SYSTEM_PROMPT_REGISTER,
	PLUGIN_CONTRIBUTION_CHANNELS.SYSTEM_PROMPT_UNREGISTER,
	PLUGIN_CONTRIBUTION_CHANNELS.GET_SETTINGS,
	PLUGIN_CONTRIBUTION_CHANNELS.SET_SETTINGS,
] as const;

export function registerPluginContributionIpc(pluginActionService: PluginActionService): () => void {
	ipcMain.handle(PLUGIN_CONTRIBUTION_CHANNELS.BEGIN_LOAD, (_event, pluginId: unknown, activationId: unknown) => {
		const normalizedPluginId = asPluginId(pluginId);
		const normalizedActivationId = asPluginId(activationId);
		pluginLog.debug("ipc agent-tools-begin-load", {
			pluginId: normalizedPluginId,
			activationId: normalizedActivationId,
		});
		pluginAgentContributionService.beginLoad(normalizedPluginId, normalizedActivationId);
		pluginActionService.beginLoad(normalizedPluginId, normalizedActivationId);
		refreshAgentPlugins();
	});
	ipcMain.handle(
		PLUGIN_CONTRIBUTION_CHANNELS.APP_ACTION_REGISTER,
		(_event, pluginId: unknown, registration: unknown) => {
			pluginActionService.register(asPluginId(pluginId), asAppActionRegistration(registration));
		},
	);
	ipcMain.handle(
		PLUGIN_CONTRIBUTION_CHANNELS.APP_ACTION_COMMIT,
		(_event, pluginId: unknown, activationId: unknown) => {
			pluginActionService.commit(asPluginId(pluginId), asPluginId(activationId));
		},
	);
	ipcMain.handle(PLUGIN_CONTRIBUTION_CHANNELS.APP_ACTION_ABORT, (_event, pluginId: unknown, activationId: unknown) => {
		pluginActionService.abort(asPluginId(pluginId), asPluginId(activationId));
	});
	ipcMain.handle(
		PLUGIN_CONTRIBUTION_CHANNELS.APP_ACTION_UNREGISTER,
		(_event, pluginId: unknown, actionId: unknown, activationId: unknown) => {
			pluginActionService.unregister(
				asPluginId(pluginId),
				asPluginId(actionId),
				asOptionalStringId(activationId, "app action activation id"),
			);
		},
	);
	ipcMain.handle(PLUGIN_CONTRIBUTION_CHANNELS.APP_ACTION_RESPONSE, (_event, requestId: unknown, result: unknown) => {
		pluginActionService.respond(asPluginId(requestId), result);
	});
	ipcMain.handle(
		PLUGIN_CONTRIBUTION_CHANNELS.CONTINUATION_REGISTER,
		(_event, pluginId: unknown, registration: unknown) => {
			pluginAgentContributionService.registerContinuation(
				asPluginId(pluginId),
				asContinuationRegistration(registration),
			);
			refreshAgentPlugins();
		},
	);
	ipcMain.handle(
		PLUGIN_CONTRIBUTION_CHANNELS.CONTINUATION_UNREGISTER,
		(_event, pluginId: unknown, providerId: unknown, activationId: unknown) => {
			pluginAgentContributionService.unregisterContinuation(
				asPluginId(pluginId),
				asPluginId(providerId),
				asOptionalStringId(activationId, "continuation activation id"),
			);
			refreshAgentPlugins();
		},
	);
	ipcMain.handle(
		PLUGIN_CONTRIBUTION_CHANNELS.SYSTEM_PROMPT_REGISTER,
		(_event, pluginId: unknown, registration: unknown) => {
			pluginAgentContributionService.registerSystemPrompt(
				asPluginId(pluginId),
				asSystemPromptProviderRegistration(registration),
			);
			refreshAgentPlugins();
		},
	);
	ipcMain.handle(
		PLUGIN_CONTRIBUTION_CHANNELS.SYSTEM_PROMPT_UNREGISTER,
		(_event, pluginId: unknown, providerId: unknown, activationId: unknown) => {
			pluginAgentContributionService.unregisterSystemPrompt(
				asPluginId(pluginId),
				asPluginId(providerId),
				asOptionalStringId(activationId, "system prompt provider activation id"),
			);
			refreshAgentPlugins();
		},
	);
	ipcMain.handle(PLUGIN_CONTRIBUTION_CHANNELS.TOOL_REGISTER, (_event, pluginId: unknown, registration: unknown) => {
		const normalizedPluginId = asPluginId(pluginId);
		const normalizedRegistration = asAgentToolRegistration(registration);
		pluginLog.debug("ipc agent-tool-register", {
			pluginId: normalizedPluginId,
			toolId: normalizedRegistration.id,
			toolName: normalizedRegistration.name,
			handlerId: normalizedRegistration.handlerId,
			activationId: normalizedRegistration.activationId,
		});
		pluginAgentContributionService.registerTool(normalizedPluginId, normalizedRegistration);
		refreshAgentPlugins();
	});
	ipcMain.handle(
		PLUGIN_CONTRIBUTION_CHANNELS.TOOL_UNREGISTER,
		(_event, pluginId: unknown, toolId: unknown, activationId: unknown) => {
			const normalizedPluginId = asPluginId(pluginId);
			const normalizedToolId = asPluginId(toolId);
			const normalizedActivationId = asOptionalStringId(activationId, "agent tool activation id");
			pluginLog.debug("ipc agent-tool-unregister", {
				pluginId: normalizedPluginId,
				toolId: normalizedToolId,
				activationId: normalizedActivationId,
			});
			pluginAgentContributionService.unregisterTool(normalizedPluginId, normalizedToolId, normalizedActivationId);
			refreshAgentPlugins();
		},
	);
	ipcMain.handle(PLUGIN_CONTRIBUTION_CHANNELS.HOOK_REGISTER, (_event, pluginId: unknown, registration: unknown) => {
		pluginAgentContributionService.registerHook(asPluginId(pluginId), asAgentHookRegistration(registration));
	});
	ipcMain.handle(
		PLUGIN_CONTRIBUTION_CHANNELS.HOOK_UNREGISTER,
		(_event, pluginId: unknown, hookId: unknown, activationId: unknown) => {
			pluginAgentContributionService.unregisterHook(
				asPluginId(pluginId),
				asPluginId(hookId),
				asOptionalStringId(activationId, "agent hook activation id"),
			);
		},
	);
	ipcMain.handle(PLUGIN_CONTRIBUTION_CHANNELS.CLEAR, (_event, pluginId: unknown, activationId: unknown) => {
		const normalizedPluginId = asPluginId(pluginId);
		const normalizedActivationId = asOptionalStringId(activationId, "agent tool activation id");
		pluginLog.debug("ipc agent-tools-clear", {
			pluginId: normalizedPluginId,
			activationId: normalizedActivationId,
		});
		pluginAgentContributionService.clear(normalizedPluginId, normalizedActivationId);
		pluginActionService.clear(normalizedPluginId, normalizedActivationId);
		refreshAgentPlugins();
	});
	ipcMain.handle(PLUGIN_CONTRIBUTION_CHANNELS.GET_SETTINGS, (_event, id: unknown) =>
		getPluginSettings(asPluginId(id)),
	);
	ipcMain.handle(PLUGIN_CONTRIBUTION_CHANNELS.SET_SETTINGS, (_event, id: unknown, values: unknown) => {
		const pluginId = asPluginId(id);
		if (values == null || typeof values !== "object" || Array.isArray(values)) {
			throw new Error("Invalid plugin settings values");
		}
		const effective = setPluginSettings(pluginId, values as Record<string, unknown>);
		refreshAgentPlugins();
		for (const contents of webContents.getAllWebContents()) {
			contents.send(PLUGIN_CONTRIBUTION_CHANNELS.SETTINGS_CHANGED, { pluginId, values: effective });
		}
	});

	return () => {
		for (const channel of handlerChannels) ipcMain.removeHandler(channel);
		pluginActionService.dispose();
	};
}
