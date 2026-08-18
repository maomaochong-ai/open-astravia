import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	getEffectiveShortcut,
	loadShortcutBindings,
	SHORTCUT_ACTIONS,
	type ShortcutBindings,
	saveShortcutBindings,
} from "../lib/shortcuts";
import { type ShortcutBinding, useShortcutScope } from "../shortcuts";

export type ShortcutHandler = (actionId: string) => void;

/**
 * Global (app-scope) keyboard shortcuts.
 *
 * Registers the bottom `app` layer on the shared ShortcutScopeStack so
 * surface/overlay/modal scopes can override keys without ad-hoc listeners.
 * Bindings load from desktop-config and subscribe to main broadcasts.
 */
export function useGlobalShortcuts(handler: ShortcutHandler): {
	customShortcuts: ShortcutBindings;
	setCustomShortcut: (actionId: string, shortcut: string) => void;
	resetShortcut: (actionId: string) => void;
	resetAll: () => void;
} {
	const [customShortcuts, setCustomShortcuts] = useState<ShortcutBindings>({});
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	useEffect(() => {
		void loadShortcutBindings().then(setCustomShortcuts);
		const unsubscribe = window.vetta.config.onShortcutsChanged((event) => {
			setCustomShortcuts(event.bindings ?? {});
		});
		return unsubscribe;
	}, []);

	const resolvedBindings = useMemo((): ShortcutBinding[] => {
		return SHORTCUT_ACTIONS.map((action) => {
			const key = getEffectiveShortcut(action.id, customShortcuts);
			const hasChord = key.includes("mod") || key.includes("ctrl") || key.includes("alt");
			return {
				key,
				// Chorded app shortcuts still work while typing; bare keys never steal from editors.
				when: hasChord ? "always" : "not-editable",
				run: () => {
					handlerRef.current(action.id);
				},
			};
		});
	}, [customShortcuts]);

	useShortcutScope({
		id: "app:global",
		kind: "app",
		active: true,
		exclusive: false,
		bindings: resolvedBindings,
	});

	const setCustomShortcut = useCallback((actionId: string, shortcut: string) => {
		setCustomShortcuts((prev) => {
			const next = { ...prev, [actionId]: shortcut };
			void saveShortcutBindings(next);
			return next;
		});
	}, []);

	const resetShortcut = useCallback((actionId: string) => {
		setCustomShortcuts((prev) => {
			const next = { ...prev };
			delete next[actionId as keyof typeof next];
			void saveShortcutBindings(next);
			return next;
		});
	}, []);

	const resetAll = useCallback(() => {
		setCustomShortcuts({});
		void saveShortcutBindings({});
	}, []);

	return { customShortcuts, setCustomShortcut, resetShortcut, resetAll };
}
