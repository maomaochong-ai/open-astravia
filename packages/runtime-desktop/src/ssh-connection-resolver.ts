import type { SshConnection } from "@vetta/ssh-transport";

export type DesktopSshConnectionResolver = (hostId: string) => SshConnection;

let resolver: DesktopSshConnectionResolver | undefined;

/**
 * 注册「按 hostId 拿到 SSH 连接」的实现。
 *
 * 连接管理器持有主机配置，而主机配置属于 Desktop 应用层；`runtime-desktop` 不能
 * 反向依赖 `apps/desktop`，所以由应用在启动时把实现注册进来。
 */
export function setDesktopSshConnectionResolver(next: DesktopSshConnectionResolver): void {
	resolver = next;
}

/**
 * 取远程项目的连接。
 *
 * 没注册就抛，**绝不**退回本地执行：本机很可能存在同名路径，本地执行会对着完全
 * 不同的仓库给出看起来成功的答案，而用户不会察觉（ADR-0124 的执行边界）。
 */
export function resolveDesktopSshConnection(hostId: string): SshConnection {
	if (!resolver) {
		throw new Error(
			`No SSH connection provider is registered; refusing to run a remote project on the local machine (host: ${hostId}).`,
		);
	}
	return resolver(hostId);
}
