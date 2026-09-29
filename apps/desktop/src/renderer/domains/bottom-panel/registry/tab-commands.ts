import { bottomPanelStateAtomFamily, dispatchBottomPanelAtomFamily, findBottomPanelTab } from "@shared/store/atoms";
import { atom, type WritableAtom } from "jotai";
import { TERMINAL_PANEL_ID } from "../builtins/terminal-panel";
import type { TerminalLaunchPayload } from "../terminal/terminal-launch";
import { bottomPanelFocusRequestAtom } from "./instance-atoms";

export interface LaunchTerminalCommand {
	readonly tabId: string;
	readonly newLeafId: string;
	/** 发起方的 tab：新终端落在它所在的格子里，用户点完就能在原处看到结果。 */
	readonly nearTabId: string;
	readonly payload: TerminalLaunchPayload;
}

/** 实例发起的 tab 操作。在写 atom 里现读布局，调用方不必订阅整棵布局树。 */
const launchTerminalAtoms = new Map<string, WritableAtom<null, [LaunchTerminalCommand], void>>();

export function launchTerminalAtomFamily(scopeKey: string): WritableAtom<null, [LaunchTerminalCommand], void> {
	const existing = launchTerminalAtoms.get(scopeKey);
	if (existing) return existing;
	const created = atom(null, (get, set, command: LaunchTerminalCommand) => {
		const near = findBottomPanelTab(get(bottomPanelStateAtomFamily(scopeKey)).root, command.nearTabId);
		set(dispatchBottomPanelAtomFamily(scopeKey), {
			type: "open-tab",
			tabId: command.tabId,
			componentId: TERMINAL_PANEL_ID,
			newLeafId: command.newLeafId,
			leafId: near?.leaf.id,
			payload: command.payload,
		});
		set(bottomPanelFocusRequestAtom, command.tabId);
	});
	launchTerminalAtoms.set(scopeKey, created);
	return created;
}

const revealTabAtoms = new Map<string, WritableAtom<null, [string], boolean>>();

export function revealTabAtomFamily(scopeKey: string): WritableAtom<null, [string], boolean> {
	const existing = revealTabAtoms.get(scopeKey);
	if (existing) return existing;
	const created = atom(null, (get, set, tabId: string) => {
		if (!findBottomPanelTab(get(bottomPanelStateAtomFamily(scopeKey)).root, tabId)) return false;
		const dispatch = dispatchBottomPanelAtomFamily(scopeKey);
		set(dispatch, { type: "set-collapsed", collapsed: false });
		set(dispatch, { type: "activate-tab", tabId });
		set(bottomPanelFocusRequestAtom, tabId);
		return true;
	});
	revealTabAtoms.set(scopeKey, created);
	return created;
}
