import { type ActionButtonDef, actionButtonDefsAtom, actionButtonHandlersAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

/**
 * Register a dynamic action button above the input bar.
 * The button is automatically removed when the component unmounts.
 */
export function useRegisterActionButton(def: ActionButtonDef, handler: () => void): void {
	const setDefs = useSetAtom(actionButtonDefsAtom);
	const setHandlers = useSetAtom(actionButtonHandlersAtom);

	useEffect(() => {
		setDefs((prev) => [...prev.filter((d) => d.id !== def.id), def]);
		setHandlers((prev) => new Map(prev).set(def.id, handler));
		return () => {
			setDefs((prev) => prev.filter((d) => d.id !== def.id));
			setHandlers((prev) => {
				const m = new Map(prev);
				m.delete(def.id);
				return m;
			});
		};
	}, [def, handler, setDefs, setHandlers]);
}
