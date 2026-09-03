import { ipcMain } from "electron";
import type {
	PluginCommandRunOptions,
	PluginOffscreenCaptureOptions,
	PluginServiceArtifactPayload,
	PluginServiceRequest,
} from "../../preload/api-types/plugins.js";
import { PLUGIN_EXECUTION_CHANNELS } from "../../shared/plugin-ipc.js";
import { getDesktopCapabilityHost } from "../capabilities/capability-host.js";
import { runPluginCommand } from "../plugins/command-runner.js";
import {
	getPluginCommandSpawnStatus,
	type SpawnPluginCommandOptions,
	spawnPluginCommand,
	stopAllPluginSpawns,
	stopPluginCommandSpawn,
} from "../plugins/command-spawner.js";
import {
	capturePluginOffscreen,
	destroyAllOffscreenSessions,
	releasePluginOffscreenSession,
} from "../plugins/offscreen-capture-service.js";
import { pluginCliProviderService } from "../plugins/plugin-cli-provider-service.js";
import { pluginServiceProviderService } from "../plugins/plugin-service-provider-service.js";
import { asPluginId } from "./plugin-input-parsers.js";

const handlerChannels = Object.values(PLUGIN_EXECUTION_CHANNELS).filter(
	(channel) =>
		channel !== PLUGIN_EXECUTION_CHANNELS.COMMAND_SPAWN_EXIT &&
		channel !== PLUGIN_EXECUTION_CHANNELS.CLI_PROVIDER_STATUS &&
		channel !== PLUGIN_EXECUTION_CHANNELS.CLI_PROVIDER_SPAWN_EXIT &&
		channel !== PLUGIN_EXECUTION_CHANNELS.SERVICE_STATUS,
);

export function registerPluginExecutionIpc(): () => void {
	const capabilityAdapter = getDesktopCapabilityHost().adapters.plugin;
	pluginCliProviderService.ensureEnabledProviders();

	ipcMain.handle(
		PLUGIN_EXECUTION_CHANNELS.COMMAND_RUN,
		(_event, sessionId: unknown, file: unknown, args: unknown, options: unknown) =>
			runPluginCommand(
				capabilityAdapter.pluginIdForSession(asPluginId(sessionId)),
				typeof file === "string" ? file : "",
				args,
				(options ?? undefined) as PluginCommandRunOptions | undefined,
			),
	);
	ipcMain.handle(
		PLUGIN_EXECUTION_CHANNELS.COMMAND_SPAWN,
		(_event, sessionId: unknown, file: unknown, args: unknown, options: unknown) =>
			spawnPluginCommand(
				capabilityAdapter.pluginIdForSession(asPluginId(sessionId)),
				typeof file === "string" ? file : "",
				args,
				(options ?? undefined) as SpawnPluginCommandOptions | undefined,
			),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.COMMAND_SPAWN_STOP, (_event, sessionId: unknown, spawnId: unknown) =>
		stopPluginCommandSpawn(capabilityAdapter.pluginIdForSession(asPluginId(sessionId)), asPluginId(spawnId)),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.COMMAND_SPAWN_STATUS, (_event, sessionId: unknown, spawnId: unknown) =>
		getPluginCommandSpawnStatus(capabilityAdapter.pluginIdForSession(asPluginId(sessionId)), asPluginId(spawnId)),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.CLI_PROVIDER_STATUS_GET, (_event, pluginId: unknown, providerId: unknown) =>
		pluginCliProviderService.getStatus(asPluginId(pluginId), asPluginId(providerId)),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.CLI_PROVIDER_RETRY, (_event, pluginId: unknown, providerId: unknown) =>
		pluginCliProviderService.retry(asPluginId(pluginId), asPluginId(providerId)),
	);
	ipcMain.handle(
		PLUGIN_EXECUTION_CHANNELS.CLI_PROVIDER_RUN,
		(_event, pluginId: unknown, providerId: unknown, args: unknown, options: unknown) =>
			pluginCliProviderService.run(
				asPluginId(pluginId),
				asPluginId(providerId),
				args,
				(options ?? undefined) as PluginCommandRunOptions | undefined,
			),
	);
	ipcMain.handle(
		PLUGIN_EXECUTION_CHANNELS.CLI_PROVIDER_SPAWN,
		(_event, pluginId: unknown, providerId: unknown, args: unknown, options: unknown) =>
			pluginCliProviderService.spawn(
				asPluginId(pluginId),
				asPluginId(providerId),
				args,
				(options ?? undefined) as SpawnPluginCommandOptions | undefined,
			),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.CLI_PROVIDER_SPAWN_STOP, (_event, pluginId: unknown, spawnId: unknown) =>
		pluginCliProviderService.stopSpawn(asPluginId(pluginId), asPluginId(spawnId)),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.CLI_PROVIDER_SPAWN_STATUS, (_event, pluginId: unknown, spawnId: unknown) =>
		pluginCliProviderService.getSpawnStatus(asPluginId(pluginId), asPluginId(spawnId)),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.SERVICE_STATUS_GET, (_event, sessionId: unknown, serviceId: unknown) =>
		pluginServiceProviderService.getStatus(
			capabilityAdapter.pluginIdForSession(asPluginId(sessionId)),
			asPluginId(serviceId),
		),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.SERVICE_PLATFORM_GET, (_event, sessionId: unknown) => {
		capabilityAdapter.pluginIdForSession(asPluginId(sessionId));
		return pluginServiceProviderService.getPlatform();
	});
	ipcMain.handle(
		PLUGIN_EXECUTION_CHANNELS.SERVICE_INSTALL,
		(_event, sessionId: unknown, serviceId: unknown, artifacts: unknown) =>
			pluginServiceProviderService.install(
				capabilityAdapter.pluginIdForSession(asPluginId(sessionId)),
				asPluginId(serviceId),
				artifacts as PluginServiceArtifactPayload[],
			),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.SERVICE_START, (_event, sessionId: unknown, serviceId: unknown) =>
		pluginServiceProviderService.start(
			capabilityAdapter.pluginIdForSession(asPluginId(sessionId)),
			asPluginId(serviceId),
		),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.SERVICE_STOP, (_event, sessionId: unknown, serviceId: unknown) =>
		pluginServiceProviderService.stop(
			capabilityAdapter.pluginIdForSession(asPluginId(sessionId)),
			asPluginId(serviceId),
		),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.SERVICE_RESTART, (_event, sessionId: unknown, serviceId: unknown) =>
		pluginServiceProviderService.restart(
			capabilityAdapter.pluginIdForSession(asPluginId(sessionId)),
			asPluginId(serviceId),
		),
	);
	ipcMain.handle(
		PLUGIN_EXECUTION_CHANNELS.SERVICE_CONNECTION,
		(_event, sessionId: unknown, serviceId: unknown, credentialId: unknown) =>
			pluginServiceProviderService.connection(
				capabilityAdapter.pluginIdForSession(asPluginId(sessionId)),
				asPluginId(serviceId),
				credentialId === undefined ? undefined : asPluginId(credentialId),
			),
	);
	ipcMain.handle(
		PLUGIN_EXECUTION_CHANNELS.SERVICE_REQUEST,
		(_event, sessionId: unknown, serviceId: unknown, request: unknown) =>
			pluginServiceProviderService.request(
				capabilityAdapter.pluginIdForSession(asPluginId(sessionId)),
				asPluginId(serviceId),
				request as PluginServiceRequest,
			),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.OFFSCREEN_CAPTURE, (_event, pluginId: unknown, options: unknown) =>
		capturePluginOffscreen(asPluginId(pluginId), (options ?? undefined) as PluginOffscreenCaptureOptions | undefined),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.OFFSCREEN_RELEASE, (_event, pluginId: unknown, sessionKey: unknown) =>
		releasePluginOffscreenSession(asPluginId(pluginId), typeof sessionKey === "string" ? sessionKey : ""),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.NETWORK_REQUEST, (_event, sessionId: unknown, request: unknown) =>
		capabilityAdapter.requestNetwork(asPluginId(sessionId), request),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.GATEWAY_REQUEST, (_event, sessionId: unknown, request: unknown) =>
		capabilityAdapter.requestGateway(asPluginId(sessionId), request),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.STORAGE_READ_JSON, (_event, sessionId: unknown, key: unknown) =>
		capabilityAdapter.readStorageJson(asPluginId(sessionId), asPluginId(key)),
	);
	ipcMain.handle(
		PLUGIN_EXECUTION_CHANNELS.STORAGE_WRITE_JSON,
		(_event, sessionId: unknown, key: unknown, value: unknown) =>
			capabilityAdapter.writeStorageJson(asPluginId(sessionId), asPluginId(key), value),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.STORAGE_LIST, (_event, sessionId: unknown, prefix: unknown) =>
		capabilityAdapter.listStorage(asPluginId(sessionId), prefix === undefined ? undefined : asPluginId(prefix)),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.STORAGE_READ_FILE, (_event, sessionId: unknown, path: unknown) =>
		capabilityAdapter.readStorageFile(asPluginId(sessionId), asPluginId(path)),
	);
	ipcMain.handle(
		PLUGIN_EXECUTION_CHANNELS.STORAGE_WRITE_FILE,
		(_event, sessionId: unknown, path: unknown, data: unknown) => {
			if (typeof data !== "string") throw new Error("Invalid plugin storage data");
			return capabilityAdapter.writeStorageFile(asPluginId(sessionId), asPluginId(path), data);
		},
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.STORAGE_PUT_BLOB, (_event, sessionId: unknown, input: unknown) =>
		capabilityAdapter.putStorageBlob(asPluginId(sessionId), input),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.STORAGE_PUT_BLOB_FROM_FILE, (_event, sessionId: unknown, input: unknown) =>
		capabilityAdapter.putStorageBlobFromFile(asPluginId(sessionId), input),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.STORAGE_READ_BLOB, (_event, sessionId: unknown, blobId: unknown) =>
		capabilityAdapter.readStorageBlob(asPluginId(sessionId), asPluginId(blobId)),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.STORAGE_GET_BLOB_REF, (_event, sessionId: unknown, blobId: unknown) =>
		capabilityAdapter.getStorageBlobRef(asPluginId(sessionId), asPluginId(blobId)),
	);

	return () => {
		for (const channel of handlerChannels) ipcMain.removeHandler(channel);
		stopAllPluginSpawns();
		pluginCliProviderService.stopAll();
		pluginServiceProviderService.stopAll();
		destroyAllOffscreenSessions();
	};
}
