import { useEffect, useRef } from "react";
import type { Disposable } from "./disposable.js";

/**
 * Keyboard shortcut scopes (priority high → low), mirroring the host stack:
 * - modal: dialogs (often exclusive)
 * - overlay: pickers / floating UI
 * - surface: previews, panels, editors
 *
 * Plugins cannot register `app` — that layer is reserved for host-configurable
 * global actions (settings → shortcuts).
 */
export type PluginShortcutScopeKind = "surface" | "overlay" | "modal";

export type PluginShortcutWhen = "always" | "editable" | "not-editable";

export interface PluginShortcutBinding {
	/**
	 * Serialized combo matching the host `eventToShortcut` format, e.g.
	 * `"mod+s"`, `"escape"`, `"arrowleft"`, `"="`, `"-"`.
	 */
	key: string;
	run: (event: KeyboardEvent) => void;
	/** Default `"always"`. Restrict to / out of editable targets. */
	when?: PluginShortcutWhen;
	/** Default true. */
	preventDefault?: boolean;
	/** Default true. */
	stopPropagation?: boolean;
}

export interface PluginShortcutScopeContribution {
	/** Local id; host namespaces as `pluginId:id`. */
	id: string;
	kind: PluginShortcutScopeKind;
	/** When true, unmatched keys do not fall through to lower scopes. */
	exclusive?: boolean;
	/** Dynamic gate; re-checked on every keydown. */
	enabled?: () => boolean;
	/**
	 * Static list or factory. Factories are read each keydown so handlers can
	 * close over the latest component state without re-registering.
	 */
	bindings: readonly PluginShortcutBinding[] | (() => readonly PluginShortcutBinding[]);
}

export type PluginRegisterShortcutScope = (contribution: PluginShortcutScopeContribution) => Disposable;

export interface UsePluginShortcutScopeOptions {
	/** Stable local id (host namespaces with plugin id). */
	id: string;
	kind: PluginShortcutScopeKind;
	/** When false, scope is not registered. Default true. */
	active?: boolean;
	exclusive?: boolean;
	enabled?: () => boolean;
	bindings: readonly PluginShortcutBinding[];
}

/**
 * Component-scoped shortcut registration for plugins.
 *
 * Pass `ctx.ui.registerShortcutScope` captured in `activate` (module-level),
 * same pattern as `notify`. While `active` is true, bindings participate in the
 * host ShortcutScopeStack — do not add ad-hoc `document` keydown listeners.
 */
export function usePluginShortcutScope(
	register: PluginRegisterShortcutScope | null | undefined,
	options: UsePluginShortcutScopeOptions,
): void {
	const bindingsRef = useRef(options.bindings);
	bindingsRef.current = options.bindings;
	const enabledRef = useRef(options.enabled);
	enabledRef.current = options.enabled;

	const keySignature = options.bindings.map((b) => `${b.key}:${b.when ?? "always"}`).join("|");
	const active = options.active !== false;

	useEffect(() => {
		if (!register || !active) return;
		const handle = register({
			id: options.id,
			kind: options.kind,
			exclusive: options.exclusive,
			enabled: enabledRef.current
				? () => {
						const gate = enabledRef.current;
						return gate ? gate() : true;
					}
				: undefined,
			bindings: () => bindingsRef.current,
		});
		return () => handle.dispose();
	}, [register, options.id, options.kind, options.exclusive, active, keySignature]);
}
