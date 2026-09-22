import {
	activeBottomPanelTab,
	activeSessionCwdAtom,
	type BottomPanelSessionState,
	bottomPanelStateAtom,
	dispatchBottomPanelAtom,
	latestBottomPanelTabOf,
} from "@shared/store/atoms";
import { parseProjectLocation } from "@vetta/ssh-transport/project-uri";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { TERMINAL_PANEL_ID } from "../builtins";
import { bottomPanelFocusRequestAtom } from "../registry/instance-atoms";
import { useTerminalCapabilities } from "./useTerminalCapabilities";

export type OpenTerminalPlan =
	| { readonly kind: "noop" }
	| { readonly kind: "activate"; readonly tabId: string }
	| { readonly kind: "create" };

/** 面板展开、且激活格子里的激活 tab 是终端：此时「打开终端」已经是现状。 */
export function isTerminalFocused(state: BottomPanelSessionState): boolean {
	return !state.collapsed && activeBottomPanelTab(state)?.componentId === TERMINAL_PANEL_ID;
}

/**
 * 头部终端入口的裁决：已经在终端里就什么都不做；有终端就回到最近用过的那个
 * （面板藏着就顺手唤起）；一个终端都没有才新建。
 */
export function planOpenTerminal(state: BottomPanelSessionState): OpenTerminalPlan {
	if (isTerminalFocused(state)) return { kind: "noop" };
	const latest = latestBottomPanelTabOf(state, TERMINAL_PANEL_ID);
	return latest ? { kind: "activate", tabId: latest.tabId } : { kind: "create" };
}

export interface OpenTerminalEntry {
	/** 本地会话缺本机 PTY 时为 false；远程会话走 SSH，与本机能力无关。 */
	readonly available: boolean;
	readonly focused: boolean;
	/** 引用稳定：会被写进头部 actions，跟着布局变就会连带整条 header 重新提交。 */
	open(): void;
}

function newId(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`;
}

/** 派生成布尔再订阅：布局里拖高度、改 payload 之类的变化不该让头部按钮跟着重渲。 */
const terminalFocusedAtom = atom((get) => isTerminalFocused(get(bottomPanelStateAtom)));

/** 在写 atom 里现读布局，而不是闭包捕获——这样 `open` 不必随布局每次变化换引用。 */
const openTerminalAtom = atom(null, (get, set) => {
	const plan = planOpenTerminal(get(bottomPanelStateAtom));
	if (plan.kind === "noop") return;
	if (plan.kind === "activate") {
		set(dispatchBottomPanelAtom, { type: "set-collapsed", collapsed: false });
		set(dispatchBottomPanelAtom, { type: "activate-tab", tabId: plan.tabId });
		set(bottomPanelFocusRequestAtom, plan.tabId);
		return;
	}
	const tabId = newId("tab");
	set(dispatchBottomPanelAtom, { type: "open-tab", tabId, componentId: TERMINAL_PANEL_ID, newLeafId: newId("leaf") });
	set(bottomPanelFocusRequestAtom, tabId);
});

/**
 * 「一步到位打开终端」。与面板里「+」新建终端走同一个 `open-tab`，
 * 只是多了「已有就复用」与「把键盘焦点送进去」两步。
 */
export function useOpenTerminal(): OpenTerminalEntry {
	const focused = useAtomValue(terminalFocusedAtom);
	const cwd = useAtomValue(activeSessionCwdAtom);
	const runOpen = useSetAtom(openTerminalAtom);
	const capabilities = useTerminalCapabilities();

	const remoteSession = useMemo(() => (cwd ? parseProjectLocation(cwd).kind === "ssh" : false), [cwd]);
	const available = remoteSession || capabilities.localPty;

	const open = useCallback(() => {
		if (available) runOpen();
	}, [available, runOpen]);

	return useMemo(() => ({ available, focused, open }), [available, focused, open]);
}
