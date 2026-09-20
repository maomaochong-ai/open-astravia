import type { SshHostInput } from "@vetta/ssh-transport";
import { ipcMain } from "electron";
import { probeSshHost } from "../ssh/ssh-host-probe.js";
import { getSshHostService, listSshConfigAliases } from "../ssh/ssh-host-service-instance.js";
import { getSshConnection, getSshHostStatus } from "../ssh/ssh-runtime.js";

const CHANNELS = {
	LIST_HOSTS: "vetta:ssh:list-hosts",
	CREATE_HOST: "vetta:ssh:create-host",
	UPDATE_HOST: "vetta:ssh:update-host",
	REMOVE_HOST: "vetta:ssh:remove-host",
	IMPORT_CONFIG: "vetta:ssh:import-config",
	LIST_CONFIG_ALIASES: "vetta:ssh:list-config-aliases",
	TEST_HOST: "vetta:ssh:test-host",
	HOST_STATUS: "vetta:ssh:get-host-status",
	LIST_REMOTE_DIR: "vetta:ssh:list-remote-dir",
} as const;

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function toHostInput(value: unknown): SshHostInput {
	const raw = (value ?? {}) as Record<string, unknown>;
	return {
		label: asString(raw.label),
		target: asString(raw.target),
		port: typeof raw.port === "number" ? raw.port : undefined,
		identityFile: typeof raw.identityFile === "string" ? raw.identityFile : undefined,
	};
}

export function registerSshIpc(): () => void {
	ipcMain.handle(CHANNELS.LIST_HOSTS, async () => {
		const hosts = await getSshHostService().list();
		// 状态是运行期信息，不进配置文件；列表一并带上，省得 UI 再逐台问一遍。
		return hosts.map((host) => ({ ...host, status: getSshHostStatus(host.id) }));
	});

	ipcMain.handle(CHANNELS.CREATE_HOST, (_event, input: unknown) => getSshHostService().create(toHostInput(input)));

	ipcMain.handle(CHANNELS.UPDATE_HOST, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return getSshHostService().update(asString(raw.id), toHostInput(raw));
	});

	ipcMain.handle(CHANNELS.REMOVE_HOST, (_event, hostId: unknown) => getSshHostService().remove(asString(hostId)));

	ipcMain.handle(CHANNELS.LIST_CONFIG_ALIASES, () => listSshConfigAliases());

	ipcMain.handle(CHANNELS.IMPORT_CONFIG, (_event, aliases: unknown) =>
		getSshHostService().importFromSshConfig(
			Array.isArray(aliases) ? aliases.filter((item): item is string => typeof item === "string") : [],
		),
	);

	ipcMain.handle(CHANNELS.TEST_HOST, (_event, hostId: unknown) => probeSshHost(asString(hostId)));

	ipcMain.handle(CHANNELS.HOST_STATUS, (_event, hostId: unknown) => getSshHostStatus(asString(hostId)));

	// 远端目录浏览器：添加远程项目时用它选目录。
	ipcMain.handle(CHANNELS.LIST_REMOTE_DIR, async (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		const connection = getSshConnection(asString(raw.hostId));
		// 缺省从家目录开始，而不是 `/`——用户的项目几乎总在家目录下。
		const remotePath = await connection.expandRemotePath(asString(raw.remotePath) || "~");
		const entries = await connection.listDirectory(remotePath);
		return { remotePath, entries };
	});

	return () => {
		for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
	};
}
