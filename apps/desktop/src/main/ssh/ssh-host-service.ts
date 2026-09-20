import { normalizeSshHostInput, type SshHost, type SshHostInput } from "@vetta/ssh-transport";
import type { DesktopConfig } from "../config/desktop-config-store.js";

export interface SshHostServiceDependencies {
	readonly readConfig: () => Promise<DesktopConfig>;
	readonly writeConfig: (config: DesktopConfig) => Promise<void>;
	readonly broadcastChanged: () => void;
	/** 主机配置变更后丢弃缓存的连接，否则改了端口仍然连着旧机器。 */
	readonly invalidateConnection: (hostId: string) => void;
	/** 是否还有项目指向这台主机。删除前要问，避免把项目留成悬空引用。 */
	readonly countProjectsOnHost: (hostId: string) => Promise<number>;
	readonly generateId: () => string;
}

export class SshHostAlreadyExistsError extends Error {
	constructor(readonly target: string) {
		super(`An SSH host for "${target}" already exists.`);
		this.name = "SshHostAlreadyExistsError";
	}
}

export class SshHostInUseError extends Error {
	constructor(
		readonly hostId: string,
		readonly projectCount: number,
	) {
		super(`SSH host ${hostId} still has ${projectCount} project(s).`);
		this.name = "SshHostInUseError";
	}
}

/**
 * SSH 主机的唯一写入者。
 *
 * 与 ProjectService 同一套理由：主机列表既能从设置页改，也能从 ssh config 导入，
 * 两条路径各自读改写会互相覆盖。
 */
export class SshHostService {
	constructor(private readonly dependencies: SshHostServiceDependencies) {}

	async list(): Promise<SshHost[]> {
		const config = await this.dependencies.readConfig();
		return (config.sshHosts ?? []).map((host) => ({ ...host }));
	}

	async get(hostId: string): Promise<SshHost | undefined> {
		return (await this.list()).find((host) => host.id === hostId);
	}

	async create(input: SshHostInput): Promise<SshHost> {
		const normalized = normalizeSshHostInput(input);
		const config = await this.dependencies.readConfig();
		const hosts = (config.sshHosts ?? []).map((host) => ({ ...host }));
		// 同一个连接目标登记两次没有意义，却会让「这个项目在哪台机器上」出现两个答案。
		if (hosts.some((host) => host.target === normalized.target)) {
			throw new SshHostAlreadyExistsError(normalized.target);
		}
		const created: SshHost = { id: this.dependencies.generateId(), ...normalized };
		hosts.push(created);
		await this.commit(config, hosts);
		return created;
	}

	async update(hostId: string, input: SshHostInput): Promise<SshHost> {
		const normalized = normalizeSshHostInput(input);
		const config = await this.dependencies.readConfig();
		const hosts = (config.sshHosts ?? []).map((host) => ({ ...host }));
		const index = hosts.findIndex((host) => host.id === hostId);
		if (index < 0) throw new Error(`SSH host not found: ${hostId}`);
		if (hosts.some((host) => host.id !== hostId && host.target === normalized.target)) {
			throw new SshHostAlreadyExistsError(normalized.target);
		}
		const updated: SshHost = { id: hostId, ...normalized };
		hosts[index] = updated;
		await this.commit(config, hosts);
		// 连接参数可能变了，缓存的连接必须作废。
		this.dependencies.invalidateConnection(hostId);
		return updated;
	}

	/**
	 * 删除主机。
	 *
	 * 仍被项目引用时拒绝：那些项目会立刻变成永远打不开的悬空条目，而用户在删除
	 * 主机时看不到自己正在同时废掉几个项目。先让调用方去处理项目。
	 */
	async remove(hostId: string): Promise<void> {
		const projectCount = await this.dependencies.countProjectsOnHost(hostId);
		if (projectCount > 0) throw new SshHostInUseError(hostId, projectCount);
		const config = await this.dependencies.readConfig();
		const hosts = (config.sshHosts ?? []).filter((host) => host.id !== hostId);
		if (hosts.length === (config.sshHosts ?? []).length) {
			throw new Error(`SSH host not found: ${hostId}`);
		}
		await this.commit(config, hosts);
		this.dependencies.invalidateConnection(hostId);
	}

	/**
	 * 从 `~/.ssh/config` 导入别名。
	 *
	 * 只新增，不覆盖：`manual` 的条目是用户手工调过的，被导入改回去等于悄悄丢掉
	 * 他的修改；已存在的 `ssh-config` 条目也保持原样，因为别名背后的参数由 OpenSSH
	 * 在连接时解析，Vetta 这边不需要缓存一份必然漂移的副本。
	 */
	async importFromSshConfig(aliases: readonly string[]): Promise<SshHost[]> {
		const config = await this.dependencies.readConfig();
		const hosts = (config.sshHosts ?? []).map((host) => ({ ...host }));
		const existing = new Set(hosts.map((host) => host.target));
		const added: SshHost[] = [];
		for (const alias of aliases) {
			if (existing.has(alias)) continue;
			const normalized = normalizeSshHostInput({ label: alias, target: alias, source: "ssh-config" });
			const host: SshHost = { id: this.dependencies.generateId(), ...normalized };
			hosts.push(host);
			added.push(host);
			existing.add(alias);
		}
		if (added.length > 0) await this.commit(config, hosts);
		return added;
	}

	private async commit(config: DesktopConfig, sshHosts: SshHost[]): Promise<void> {
		await this.dependencies.writeConfig({ ...config, sshHosts });
		this.dependencies.broadcastChanged();
	}
}
