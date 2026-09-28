import { bottomPanelStateAtomFamily, dispatchBottomPanelAtomFamily } from "@shared/store/atoms";
import type { WorkSurfaceScope } from "@shared/workspace/work-surface";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";

export interface BottomPanelToggle {
	readonly open: boolean;
	toggle(): void;
}

export function useBottomPanelToggle(scope: WorkSurfaceScope | null): BottomPanelToggle {
	const scopeKey = scope?.key ?? "bottom-panel:unbound";
	const state = useAtomValue(bottomPanelStateAtomFamily(scopeKey));
	const dispatch = useSetAtom(dispatchBottomPanelAtomFamily(scopeKey));
	const open = Boolean(scope) && !state.collapsed;
	const toggle = useCallback(() => {
		if (!scope) return;
		dispatch({ type: "set-collapsed", collapsed: open });
	}, [dispatch, open, scope]);

	return useMemo(() => ({ open, toggle }), [open, toggle]);
}
