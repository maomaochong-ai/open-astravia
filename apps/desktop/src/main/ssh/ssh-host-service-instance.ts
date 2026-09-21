import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseProjectLocation, parseSshConfigAliases } from "@vetta/ssh-transport";
import { readDesktopConfig, writeSshHosts } from "../config/desktop-config-store.js";
import { broadcastSshHostsChanged } from "./ssh-events.js";
import { SshHostService } from "./ssh-host-service.js";
import { getSshConnectionManager } from "./ssh-runtime.js";

let service: SshHostService | undefined;

/** 进程内唯一的 SSH 主机服务，理由同 {@link getDesktopProjectService}。 */
export function getSshHostService(): SshHostService {
	service ??= new SshHostService({
		readHosts: async () => (await readDesktopConfig()).sshHosts ?? [],
		writeHosts: writeSshHosts,
		broadcastChanged: broadcastSshHostsChanged,
		invalidateConnection: (hostId) => getSshConnectionManager().invalidate(hostId),
		countProjectsOnHost: async (hostId) => {
			const config = await readDesktopConfig();
			return [...config.projects, ...config.archivedProjects].filter((entry) => {
				const location = safeParseLocation(entry.path);
				return location?.kind === "ssh" && location.hostId === hostId;
			}).length;
		},
		generateId: () => randomUUID(),
	});
	return service;
}

/** 读取用户的 `~/.ssh/config`，返回其中可直接连接的别名。文件不存在时返回空列表。 */
export async function listSshConfigAliases(): Promise<string[]> {
	try {
		const content = await readFile(join(homedir(), ".ssh", "config"), "utf8");
		return parseSshConfigAliases(content);
	} catch {
		// 没有 ssh config 是完全正常的情况，不是错误。
		return [];
	}
}

/**
 * 解析失败时返回 undefined 而不是抛。
 *
 * 这里在统计「有多少项目用着这台主机」，一条畸形条目不该让整个删除流程失败；
 * 它本来也不可能指向任何主机。
 */
function safeParseLocation(value: string): ReturnType<typeof parseProjectLocation> | undefined {
	try {
		return parseProjectLocation(value);
	} catch {
		return undefined;
	}
}
