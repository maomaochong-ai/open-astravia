import { TerminalSurface } from "../terminal/TerminalSurface";
import type { BottomPanelBuiltin } from "./types";

export const TERMINAL_PANEL_ID = "terminal";

export const terminalPanelBuiltin: BottomPanelBuiltin = {
	id: TERMINAL_PANEL_ID,
	order: 0,
	icon: "icon-[solar--command-linear]",
	labelKey: "bottomPanel.terminal.title",
	// 不设 maxInstances：同时开几个终端是最常见的用法（一个跑 dev server、一个敲命令）。
	requiresLocalPty: true,
	component: TerminalSurface,
};
