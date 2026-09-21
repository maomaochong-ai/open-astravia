import { terminalPanelBuiltin } from "./terminal-panel";
import type { BottomPanelBuiltin } from "./types";

/** 内置底部面板组件。长度固定，`useBottomPanelDefinitions` 在它上面按序调用 hook。 */
export const BUILTIN_BOTTOM_PANELS: readonly BottomPanelBuiltin[] = [terminalPanelBuiltin];

export { TERMINAL_PANEL_ID } from "./terminal-panel";
export type { BottomPanelBuiltin } from "./types";
