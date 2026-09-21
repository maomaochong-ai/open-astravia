import type { SshHostInput } from "@vetta/ssh-transport";
import { ipcMain } from "electron";
import { getSshPortForwardService } from "../ssh/port-forward-service.js";
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
	LIST_LISTENING_PORTS: "vetta:ssh:list-listening-ports",
	LIST_FORWARDS: "vetta:ssh:list-port-forwards",
	OPEN_FORWARD: "vetta:ssh:open-port-forward",
	CLOSE_FORWARD: "vetta:ssh:close-port-forward",
} as const;

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asPort(value: unknown): number {
	// 端口号的合法区间由服务判定并给出可读错误，这里只负责把非数字挡成一个必然被拒的值。
	return typeof value === "number" ? value : -1;
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

	ipcMain.handle(CHANNELS.REMOVE_HOST, async (_event, hostId: unknown) => {
		const id = asString(hostId);
		await getSshHostService().remove(id);
		// 主机没了，它的转发也就指不到任何地方；留着只会在端口面板里当一条撤不掉的死条目。
		await getSshPortForwardService().closeHost(id);
	});

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

	// 远端正在监听的端口：端口面板据此给出「要不要转发它」的候选。
	ipcMain.handle(CHANNELS.LIST_LISTENING_PORTS, (_event, hostId: unknown) =>
		getSshConnection(asString(hostId)).listListeningPorts(),
	);

	ipcMain.handle(CHANNELS.LIST_FORWARDS, (_event, hostId: unknown) => {
		const scope = asString(hostId);
		return getSshPortForwardService().list(scope === "" ? undefined : scope);
	});

	ipcMain.handle(CHANNELS.OPEN_FORWARD, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return getSshPortForwardService().open({
			hostId: asString(raw.hostId),
			remotePort: asPort(raw.remotePort),
			// 给了就按用户点名的号来，包括「把已有的这条换到这个号上」。
			localPort: typeof raw.localPort === "number" ? raw.localPort : undefined,
			label: typeof raw.label === "string" ? raw.label : undefined,
			source: raw.source === "detected" ? "detected" : "manual",
		});
	});

	ipcMain.handle(CHANNELS.CLOSE_FORWARD, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return getSshPortForwardService().close(asString(raw.hostId), asPort(raw.remotePort));
	});

	return () => {
		for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
	};
}
