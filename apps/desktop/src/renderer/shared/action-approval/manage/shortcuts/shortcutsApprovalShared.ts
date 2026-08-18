import { formatShortcut } from "@shared/lib/platform";
import { isShortcutActionId, SHORTCUT_ACTIONS, type ShortcutActionId } from "@/shared/shortcuts";

export const SHORTCUTS_APPROVAL_ICON = "icon-[mdi--keyboard-outline]";
export const QUICK_PANEL_APPROVAL_ICON = "icon-[mdi--lightning-bolt-outline]";

export type QuickPanelTrigger = "none" | "mod" | "alt" | "shift";
export type QuickPanelBehavior = "foreground" | "background";

export const QUICK_PANEL_TRIGGERS: readonly QuickPanelTrigger[] = ["none", "mod", "alt", "shift"];
export const QUICK_PANEL_BEHAVIORS: readonly QuickPanelBehavior[] = ["foreground", "background"];

export function resolveShortcutActionId(value: string | undefined): ShortcutActionId {
	if (value && isShortcutActionId(value)) return value;
	return SHORTCUT_ACTIONS[0].id;
}

export function getShortcutActionDefault(id: ShortcutActionId): string {
	const found = SHORTCUT_ACTIONS.find((action) => action.id === id);
	return found?.defaultShortcut ?? "";
}

export function formatShortcutDisplay(shortcut: string): string {
	if (!shortcut) return "";
	return formatShortcut(shortcut);
}

export { SHORTCUT_ACTIONS, isShortcutActionId, type ShortcutActionId };
