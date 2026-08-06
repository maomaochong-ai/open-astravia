import { useEffect, useRef } from "react";
import { getShortcutScopeStack, type ShortcutBinding, type ShortcutScopeKind } from "./scope-stack";

export interface UseShortcutScopeOptions {
	/** Stable id for debugging / replace semantics. */
	id: string;
	kind: ShortcutScopeKind;
	/** When false, scope is not registered. Default true. */
	active?: boolean;
	/** Unmatched keys do not fall through. Default false. */
	exclusive?: boolean;
	bindings: readonly ShortcutBinding[];
}

/**
 * Register a keyboard shortcut scope for the lifetime of the component
 * (while `active` is true). Handlers always see the latest `bindings` via ref.
 */
export function useShortcutScope({
	id,
	kind,
	active = true,
	exclusive = false,
	bindings,
}: UseShortcutScopeOptions): void {
	const bindingsRef = useRef(bindings);
	bindingsRef.current = bindings;

	const keySignature = bindings.map((b) => `${b.key}:${b.when ?? "always"}`).join("|");

	useEffect(() => {
		if (!active) return;
		// Re-register when the binding key set changes (handlers stay fresh via ref).
		void keySignature;
		const handle = getShortcutScopeStack().register({
			id,
			kind,
			exclusive,
			getBindings: () => bindingsRef.current,
		});
		return () => handle.dispose();
	}, [id, kind, exclusive, active, keySignature]);
}
