import type { PortForward } from "@preload/api-types/ssh";
import { parseProjectLocation } from "@vetta/ssh-transport/project-uri";
import { useEffect, useState } from "react";

/** 远程项目的 hostId；本机项目返回 null。 */
export function useRemoteProjectHostId(cwd: string | null): string | null {
	if (!cwd) return null;
	const location = parseProjectLocation(cwd);
	return location.kind === "ssh" ? location.hostId : null;
}

/**
 * 一台主机上已建立的端口转发。
 *
 * 事实源在主进程：转发会因巡检重建或失败而自己变化，也可能由插件、模型建立，都不经过当前
 * 页面。所以订阅广播后整份重读，而不是在渲染进程里维护一份增量。
 */
export function useSshPortForwards(hostId: string | null): readonly PortForward[] {
	const [forwards, setForwards] = useState<readonly PortForward[]>([]);

	useEffect(() => {
		if (!hostId) {
			setForwards([]);
			return;
		}
		let cancelled = false;
		const refresh = async (): Promise<void> => {
			const next = await window.vetta.ssh.listPortForwards(hostId);
			if (!cancelled) setForwards(next);
		};
		void refresh();
		const off = window.vetta.ssh.onPortForwardsChanged(() => void refresh());
		return () => {
			cancelled = true;
			off();
		};
	}, [hostId]);

	return forwards;
}
