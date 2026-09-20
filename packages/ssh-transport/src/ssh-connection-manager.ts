import { SshTransportError } from "./errors.js";
import type { SshProcessRunner } from "./process-runner.js";
import { buildControlPath } from "./ssh-argv.js";
import { SshConnection } from "./ssh-connection.js";
import type { SshConnectionStatus, SshHost } from "./ssh-host.js";

export interface SshConnectionManagerOptions {
	readonly runner: SshProcessRunner;
	/** ControlMaster socket 所在目录。必须短，见 {@link buildControlPath}。 */
	readonly controlDirectory: string;
	/** 查主机。返回 undefined 表示这台主机已经被用户删掉。 */
	readonly resolveHost: (hostId: string) => SshHost | undefined;
	/**
	 * 传给 ssh 子进程的额外环境变量。
	 *
	 * 按 hostId 生成而不是全局共享一份：askpass 要靠环境变量知道这次提示属于哪台主机，
	 * 才能取对凭据、也才能在弹窗里说清是谁在要口令。
	 */
	readonly resolveEnv?: (hostId: string) => Readonly<Record<string, string>> | undefined;
	readonly onStatusChanged?: (hostId: string, status: SshConnectionStatus) => void;
}

/**
 * 按主机复用连接对象。
 *
 * 复用的是 `SshConnection` 这个壳以及它缓存的平台探测结果；真正的连接复用发生在
 * OpenSSH 的 ControlMaster 里。两层缓存都以 hostId 为键，主机配置一改就必须整个丢弃，
 * 否则改了端口之后仍然连着旧机器，而 UI 显示的是新配置。
 */
export class SshConnectionManager {
	private readonly connections = new Map<string, SshConnection>();
	private readonly statuses = new Map<string, SshConnectionStatus>();

	constructor(private readonly options: SshConnectionManagerOptions) {}

	getStatus(hostId: string): SshConnectionStatus {
		return this.statuses.get(hostId) ?? "disconnected";
	}

	/**
	 * 取这台主机的连接。
	 *
	 * 主机不存在时抛而不是返回 null：调用点全是「对远程项目做一次操作」，拿不到连接
	 * 只能是失败，返回空值只会让调用方多写一条本不该存在的回退分支。
	 */
	connection(hostId: string): SshConnection {
		const existing = this.connections.get(hostId);
		if (existing) return existing;
		const host = this.options.resolveHost(hostId);
		if (!host) {
			throw new SshTransportError(`Unknown SSH host: ${hostId}`, hostId, "");
		}
		const connection = new SshConnection(host, {
			runner: this.options.runner,
			controlPath: buildControlPath(this.options.controlDirectory, hostId),
			env: this.options.resolveEnv?.(hostId),
		});
		this.connections.set(hostId, connection);
		return connection;
	}

	/** 连通性探测。成功即把状态置为 connected，失败按 ADR-0124 置为 unverifiable。 */
	async probe(hostId: string, signal?: AbortSignal): Promise<SshConnectionStatus> {
		this.setStatus(hostId, "connecting");
		try {
			await this.connection(hostId).probePlatform(signal);
			this.setStatus(hostId, "connected");
		} catch {
			// 探测失败只说明「现在问不到」，不代表远端不存在或已关机。
			this.setStatus(hostId, "unverifiable");
		}
		return this.getStatus(hostId);
	}

	/** 主机配置变更或被删除时调用，丢弃缓存的连接与平台信息。 */
	invalidate(hostId: string): void {
		this.connections.delete(hostId);
		this.setStatus(hostId, "disconnected");
	}

	private setStatus(hostId: string, status: SshConnectionStatus): void {
		if (this.statuses.get(hostId) === status) return;
		this.statuses.set(hostId, status);
		this.options.onStatusChanged?.(hostId, status);
	}
}
