import { actionButtonHandlersAtom, visibleActionButtonsAtom } from "@shared/store/atoms";
import type { ActionButtonBarItem } from "@vetta/theme-ui/chat";
import { useAtomValue } from "jotai";
import { useCallback } from "react";

export interface ActionButtonBarModel {
	buttons: ActionButtonBarItem[];
	onClick: (id: string) => void;
}

export function useActionButtonBarModel(): ActionButtonBarModel | null {
	const buttons = useAtomValue(visibleActionButtonsAtom);
	const handlers = useAtomValue(actionButtonHandlersAtom);

	const onClick = useCallback(
		(id: string) => {
			handlers.get(id)?.();
		},
		[handlers],
	);

	if (buttons.length === 0) return null;

	return {
		buttons,
		onClick,
	};
}
