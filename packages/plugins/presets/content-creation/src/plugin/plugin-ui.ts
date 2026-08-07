import type { PluginRegisterShortcutScope } from "@vetta-org/plugin-sdk";

/**
 * Captured in activate for React components (same pattern as media-viewer notify).
 * Components must not call host APIs directly.
 */
let registerShortcutScope: PluginRegisterShortcutScope | null = null;
let setActivityPanelWidth: ((width: number | "max") => void) | null = null;

export function setRegisterShortcutScope(register: PluginRegisterShortcutScope | null): void {
	registerShortcutScope = register;
}

export function getRegisterShortcutScope(): PluginRegisterShortcutScope | null {
	return registerShortcutScope;
}

export function setActivityPanelWidthController(controller: ((width: number | "max") => void) | null): void {
	setActivityPanelWidth = controller;
}

export function maximizeActivityPanel(): void {
	setActivityPanelWidth?.("max");
}
