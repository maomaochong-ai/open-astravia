import type { PluginRegisterShortcutScope } from "@vetta-org/plugin-sdk";

/**
 * Captured in activate for React components (same pattern as notify).
 * Components must not call host APIs directly.
 */
let registerShortcutScope: PluginRegisterShortcutScope | null = null;

export function setRegisterShortcutScope(register: PluginRegisterShortcutScope | null): void {
	registerShortcutScope = register;
}

export function getRegisterShortcutScope(): PluginRegisterShortcutScope | null {
	return registerShortcutScope;
}
