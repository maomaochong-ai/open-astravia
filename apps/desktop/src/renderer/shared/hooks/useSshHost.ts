import type { SshHost } from "@vetta/ssh-transport";
import { useEffect, useState } from "react";

/**
 * 把远程项目路径里的 hostId 换成用户给这台主机起的名字。
 *
 * 路径里存的是 hostId（一个 UUID），因为主机改名不该让已有项目失效；但 UUID 对用户没有
 * 任何意义，界面上必须换回名字。查表只能问主进程，所以这里做成 hook 而不是纯函数。
 *
 * 主机可能被改名或删除，且都不经过当前页面，故订阅变更事件；查不到时返回 undefined，
 * 由调用方决定退回什么——绝不拿 hostId 顶替，那等于把一串 UUID 摆到用户面前。
 */
export function useSshHost(hostId: string | null | undefined): SshHost | undefined {
	const [hosts, setHosts] = useState<readonly SshHost[]>([]);

	useEffect(() => {
		if (!hostId) return;
		let cancelled = false;
		const refresh = async (): Promise<void> => {
			const next = await window.vetta.ssh.listHosts();
			if (!cancelled) setHosts(next);
		};
		void refresh();
		const offHosts = window.vetta.ssh.onHostsChanged(() => void refresh());
		return () => {
			cancelled = true;
			offHosts();
		};
	}, [hostId]);

	return hostId ? hosts.find((host) => host.id === hostId) : undefined;
}
