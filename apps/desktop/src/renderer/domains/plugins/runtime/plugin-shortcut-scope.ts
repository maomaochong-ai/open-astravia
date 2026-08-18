import type { PluginShortcutBinding, PluginShortcutScopeKind } from "@vetta-org/plugin-sdk";
import type { ShortcutBinding, ShortcutScopeKind } from "../../../shared/shortcuts";
import { getShortcutScopeStack } from "../../../shared/shortcuts";

const PLUGIN_SHORTCUT_KINDS = new Set<PluginShortcutScopeKind>(["surface", "overlay", "modal"]);
const PLUGIN_SHORTCUT_WHEN = new Set(["always", "editable", "not-editable"]);

export function normalizePluginShortcutBindings(raw: unknown): ShortcutBinding[] {
	if (!Array.isArray(raw)) {
		throw new Error("Shortcut scope bindings must be an array or a factory returning an array");
	}
	const out: ShortcutBinding[] = [];
	for (const item of raw) {
		if (item == null || typeof item !== "object") {
			throw new Error("Shortcut binding must be an object");
		}
		const binding = item as Partial<PluginShortcutBinding>;
		if (typeof binding.key !== "string" || binding.key.trim().length === 0) {
			throw new Error("Shortcut binding key is required");
		}
		if (typeof binding.run !== "function") {
			throw new Error(`Shortcut binding "${binding.key}" requires a run handler`);
		}
		let when: ShortcutBinding["when"];
		if (binding.when === undefined) {
			when = undefined;
		} else if (typeof binding.when === "string" && PLUGIN_SHORTCUT_WHEN.has(binding.when)) {
			when = binding.when as ShortcutBinding["when"];
		} else {
			throw new Error(`Shortcut binding "${binding.key}" has invalid when (use always|editable|not-editable)`);
		}
		out.push({
			key: binding.key.trim().toLowerCase(),
			run: binding.run,
			when,
			preventDefault: binding.preventDefault === false ? false : undefined,
			stopPropagation: binding.stopPropagation === false ? false : undefined,
		});
	}
	return out;
}

export function assertPluginShortcutScopeKind(kind: unknown): ShortcutScopeKind {
	if (typeof kind !== "string" || !PLUGIN_SHORTCUT_KINDS.has(kind as PluginShortcutScopeKind)) {
		throw new Error(
			'Shortcut scope kind must be "surface", "overlay", or "modal" (kind "app" is reserved for the host)',
		);
	}
	return kind as ShortcutScopeKind;
}

export function registerPluginShortcutScopeOnHost(options: {
	scopeId: string;
	kind: ShortcutScopeKind;
	exclusive?: boolean;
	enabled?: () => boolean;
	getBindings: () => readonly ShortcutBinding[];
}): { dispose: () => void } {
	// Validate at least once at register time so authors fail early.
	if (options.getBindings().length === 0) {
		throw new Error("Shortcut scope must declare at least one binding with a non-empty key");
	}
	const handle = getShortcutScopeStack().register({
		id: options.scopeId,
		kind: options.kind,
		exclusive: options.exclusive === true,
		enabled: options.enabled,
		getBindings: options.getBindings,
	});
	let disposed = false;
	return {
		dispose: () => {
			if (disposed) return;
			disposed = true;
			handle.dispose();
		},
	};
}
