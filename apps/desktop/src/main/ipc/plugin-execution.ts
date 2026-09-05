import { ipcMain, webContents } from "electron";
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
import {
	deletePluginSecret,
	getPluginSecret,
	hasPluginSecret,
	listPluginSecretKeys,
	setPluginSecret,
} from "../plugins/plugin-catalog.js";
import { pluginCliProviderService } from "../plugins/plugin-cli-provider-service.js";
import { pluginServiceProviderService } from "../plugins/plugin-service-provider-service.js";
import { asPluginId, asRequiredString } from "./plugin-input-parsers.js";

const asSecretKey = (value: unknown): string => asRequiredString(value, "plugin secret key");

const handlerChannels = Object.values(PLUGIN_EXECUTION_CHANNELS).filter(
	(channel) =>
		channel !== PLUGIN_EXECUTION_CHANNELS.COMMAND_SPAWN_EXIT &&
		channel !== PLUGIN_EXECUTION_CHANNELS.CLI_PROVIDER_STATUS &&
		channel !== PLUGIN_EXECUTION_CHANNELS.CLI_PROVIDER_SPAWN_EXIT &&
		channel !== PLUGIN_EXECUTION_CHANNELS.SERVICE_STATUS &&
		channel !== PLUGIN_EXECUTION_CHANNELS.SECRETS_CHANGED,
);

/** 同一插件可能同时开着多个视图；密钥变更要让它们各自的 onChange 都收到。 */
function broadcastSecretsChanged(pluginId: string, keys: readonly string[]): void {
	for (const contents of webContents.getAllWebContents()) {
		if (contents.isDestroyed()) continue;
		try {
			contents.send(PLUGIN_EXECUTION_CHANNELS.SECRETS_CHANGED, { pluginId, keys });
		} catch {
			// ignore gone frames
		}
	}
}

export function registerPluginExecutionIpc(): () => void {
	const capabilityAdapter = getDesktopCapabilityHost().adapters.plugin;
	/** 密钥归属只认 capability session，绝不接受调用方自报的 plugin id。 */
	const secretsPluginId = (sessionId: unknown, permission: string): string =>
		capabilityAdapter.pluginIdForSession(asPluginId(sessionId), { permission });
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
	ipcMain.handle(
		PLUGIN_EXECUTION_CHANNELS.SERVICE_READY_REPORT,
		(_event, sessionId: unknown, serviceId: unknown, ready: unknown) => {
			if (typeof ready !== "boolean") throw new Error("Invalid service readiness value");
			return pluginServiceProviderService.reportReady(
				capabilityAdapter.pluginIdForSession(asPluginId(sessionId)),
				asPluginId(serviceId),
				ready,
			);
		},
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

	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.SECRETS_GET, (_event, sessionId: unknown, key: unknown) =>
		getPluginSecret(secretsPluginId(sessionId, "secrets.read"), asSecretKey(key)),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.SECRETS_HAS, (_event, sessionId: unknown, key: unknown) =>
		hasPluginSecret(secretsPluginId(sessionId, "secrets.read"), asSecretKey(key)),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.SECRETS_KEYS, (_event, sessionId: unknown) =>
		listPluginSecretKeys(secretsPluginId(sessionId, "secrets.read")),
	);
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.SECRETS_SET, (_event, sessionId: unknown, key: unknown, value: unknown) => {
		if (typeof value !== "string") throw new Error("Plugin secret value must be a string");
		const pluginId = secretsPluginId(sessionId, "secrets.write");
		const name = asSecretKey(key);
		setPluginSecret(pluginId, name, value);
		broadcastSecretsChanged(pluginId, [name]);
	});
	ipcMain.handle(PLUGIN_EXECUTION_CHANNELS.SECRETS_DELETE, (_event, sessionId: unknown, key: unknown) => {
		const pluginId = secretsPluginId(sessionId, "secrets.write");
		const name = asSecretKey(key);
		deletePluginSecret(pluginId, name);
		broadcastSecretsChanged(pluginId, [name]);
	});

	return () => {
		for (const channel of handlerChannels) ipcMain.removeHandler(channel);
		stopAllPluginSpawns();
		pluginCliProviderService.stopAll();
		pluginServiceProviderService.stopAll();
		destroyAllOffscreenSessions();
	};
}
