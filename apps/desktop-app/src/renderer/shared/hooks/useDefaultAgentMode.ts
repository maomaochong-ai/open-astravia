import { type AgentMode, defaultAgentModeAtom } from "@shared/store/atoms";
import { useAtom } from "jotai";
import { useCallback, useEffect } from "react";

/**
 * 新会话的默认工作模式（agent_mode 轴）。
 * - 初始化：从主进程 desktop-config 的 defaultAgentMode 水合。
 * - 同步：订阅主进程 agent-mode-changed 广播，让多窗口的新会话页 toggle 显示一致。
 * - 切换：乐观即时切本窗口，再写主进程持久化（广播回环幂等）。
 *
 * 模式在会话创建时固化、会话内不可变，因此这里没有「会话级读写」路径：
 * 改这个值只影响下一个新会话，不会改动任何已存在的会话。
 */
export function useDefaultAgentMode(): {
	defaultAgentMode: AgentMode;
	setDefaultAgentMode: (mode: AgentMode) => Promise<void>;
} {
	const [defaultAgentMode, setAtom] = useAtom(defaultAgentModeAtom);

	useEffect(() => {
		let disposed = false;
		void window.vetta.config.get().then((config) => {
			if (disposed) return;
			// 合法性由主进程按模式注册表校验（ADR-0071）；renderer 不复刻注册表。
			if (typeof config.defaultAgentMode === "string" && config.defaultAgentMode) {
				setAtom(config.defaultAgentMode);
			}
		});
		const unsubscribe = window.vetta.session.onAgentModeChanged((mode) => {
			setAtom(mode);
		});
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, [setAtom]);

	const setDefaultAgentMode = useCallback(
		async (mode: AgentMode): Promise<void> => {
			if (mode === defaultAgentMode) return;
			setAtom(mode);
			await window.vetta.session.setGlobalAgentMode(mode);
		},
		[defaultAgentMode, setAtom],
	);

	return { defaultAgentMode, setDefaultAgentMode };
}
