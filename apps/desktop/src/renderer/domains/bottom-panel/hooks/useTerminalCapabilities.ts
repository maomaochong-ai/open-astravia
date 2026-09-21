import { useEffect, useState } from "react";
import type { TerminalCapabilities } from "../../../../shared/terminal-ipc";

/**
 * 本机 PTY 能力探测结果。
 *
 * 结果在一次运行里不会变（取决于装进来的预编译二进制），所以全渲染进程只问一次，
 * 而不是每次打开面板都走一趟 IPC。默认乐观（可用）：只有确认失败才收起终端入口，
 * 免得首帧因为还没问到就把入口藏起来又冒出来。
 */
let cached: TerminalCapabilities | undefined;
let inFlight: Promise<TerminalCapabilities> | undefined;

const OPTIMISTIC: TerminalCapabilities = { localPty: true };

async function loadCapabilities(): Promise<TerminalCapabilities> {
	if (cached) return cached;
	if (!inFlight) {
		inFlight = window.vetta.terminal
			.capabilities()
			.then((result) => {
				cached = result;
				return result;
			})
			.catch(() => OPTIMISTIC)
			.finally(() => {
				inFlight = undefined;
			});
	}
	return inFlight;
}

/** 仅供测试重置探测缓存。 */
export function resetTerminalCapabilitiesCacheForTests(): void {
	cached = undefined;
	inFlight = undefined;
}

export function useTerminalCapabilities(): TerminalCapabilities {
	const [capabilities, setCapabilities] = useState<TerminalCapabilities>(cached ?? OPTIMISTIC);

	useEffect(() => {
		if (cached) return;
		let active = true;
		void loadCapabilities().then((result) => {
			if (active) setCapabilities(result);
		});
		return () => {
			active = false;
		};
	}, []);

	return capabilities;
}
