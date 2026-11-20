import type { SshHostInput } from "@astravia/ssh-transport";
import { ipcMain } from "electron";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { getAppLogger } from "../logger.js";
import { getSshPortForwardService } from "../ssh/port-forward-service.js";
import { probeSshHost } from "../ssh/ssh-host-probe.js";
import { SshHostRebindError } from "../ssh/ssh-host-service.js";
import { getSshHostService, listSshConfigAliases } from "../ssh/ssh-host-service-instance.js";
import { sshCredentialRef } from "../ssh/ssh-prompt-service.js";
import { getSshConnection, getSshHostStatus } from "../ssh/ssh-runtime.js";

const CHANNELS = {
	LIST_HOSTS: "astravia:ssh:list-hosts",
	CREATE_HOST: "astravia:ssh:create-host",
	UPDATE_HOST: "astravia:ssh:update-host",
	REMOVE_HOST: "astravia:ssh:remove-host",
	REBIND_HOST: "astravia:ssh:rebind-host",
	IMPORT_CONFIG: "astravia:ssh:import-config",
	LIST_CONFIG_ALIASES: "astravia:ssh:list-config-aliases",
	TEST_HOST: "astravia:ssh:test-host",
	HOST_STATUS: "astravia:ssh:get-host-status",
	LIST_REMOTE_DIR: "astravia:ssh:list-remote-dir",
	LIST_LISTENING_PORTS: "astravia:ssh:list-listening-ports",
	LIST_FORWARDS: "astravia:ssh:list-port-forwards",
	OPEN_FORWARD: "astravia:ssh:open-port-forward",
	CLOSE_FORWARD: "astravia:ssh:close-port-forward",
	TERMINATE_PROCESS: "astravia:ssh:terminate-process",
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
		authMethod: raw.authMethod === "password" ? "password" : "key",
	};
}

/** 口令进加密凭据库；切回私钥登录时把旧口令清掉，不留在磁盘上。 */
function syncHostPassword(hostId: string, authMethod: unknown, password: unknown): void {
	const ref = sshCredentialRef(hostId, "password");
	const vault = getDesktopCredentialVault();
	if (authMethod !== "password") {
		vault.remove(ref);
		return;
	}
	// 空串表示「沿用已保存的口令」。
	if (typeof password === "string" && password.length > 0) {
		try {
			vault.put(ref, password, { kind: "password", consumer: "ssh" });
		} catch (error) {
			/*
			 * 安全存储不可用时存不下口令：主机本身已登记，连接时会改为当场询问，功能不失。
			 * 但这必须留下痕迹——否则用户「明明填了口令」，下次连接还要再输一遍，而界面上
			 * 找不到任何解释。
			 */
			log.warn("failed to persist ssh host password; connection will prompt again", {
				hostId,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

const log = getAppLogger("ssh-ipc");

export function registerSshIpc(): () => void {
	ipcMain.handle(CHANNELS.LIST_HOSTS, async () => {
		const hosts = await getSshHostService().list();
		// 状态是运行期信息，不进配置文件；列表一并带上，省得 UI 再逐台问一遍。
		return hosts.map((host) => ({ ...host, status: getSshHostStatus(host.id) }));
	});

	ipcMain.handle(CHANNELS.CREATE_HOST, async (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		const created = await getSshHostService().create(toHostInput(input));
		syncHostPassword(created.id, raw.authMethod, raw.password);
		return created;
	});

	ipcMain.handle(CHANNELS.UPDATE_HOST, async (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		const updated = await getSshHostService().update(asString(raw.id), toHostInput(raw));
		syncHostPassword(updated.id, raw.authMethod, raw.password);
		return updated;
	});

	ipcMain.handle(CHANNELS.REMOVE_HOST, async (_event, hostId: unknown) => {
		const id = asString(hostId);
		await getSshHostService().remove(id);
		getDesktopCredentialVault().remove(sshCredentialRef(id, "password"));
		// 主机没了，它的转发也就指不到任何地方；留着只会在端口面板里当一条撤不掉的死条目。
		await getSshPortForwardService().closeHost(id);
	});

	// 结果而非异常：IPC 只把异常的 message 带过去，界面要按拒绝原因给出不同的说明。
	ipcMain.handle(CHANNELS.REBIND_HOST, async (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		const hostId = asString(raw.hostId);
		try {
			const host = await getSshHostService().rebind(hostId, asString(raw.orphanId));
			// 转发账本按 hostId 记账，换了 id 的主机上那些转发再也对不上号。
			await getSshPortForwardService().closeHost(hostId);
			return { ok: true, host };
		} catch (error) {
			if (error instanceof SshHostRebindError) {
				return { ok: false, reason: error.reason, projectCount: error.projectCount };
			}
			throw error;
		}
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
		const connection = await getSshConnection(asString(raw.hostId));
		// 缺省从家目录开始，而不是 `/`——用户的项目几乎总在家目录下。
		const remotePath = await connection.expandRemotePath(asString(raw.remotePath) || "~");
		const entries = await connection.listDirectory(remotePath);
		return { remotePath, entries };
	});

	// 远端正在监听的端口：端口面板据此给出「要不要转发它」的候选。
	ipcMain.handle(CHANNELS.LIST_LISTENING_PORTS, (_event, hostId: unknown) =>
		getSshConnection(asString(hostId)).then((c) => c.listListeningPorts()),
	);

	// 端口面板里「停掉这个服务」。pid 由界面从扫描结果里带回来，非法值交给连接层拒绝。
	ipcMain.handle(CHANNELS.TERMINATE_PROCESS, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return getSshConnection(asString(raw.hostId)).then((c) =>
			c.terminateProcess(typeof raw.pid === "number" ? raw.pid : -1, { force: raw.force === true }),
		);
	});

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
