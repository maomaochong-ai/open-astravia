import { useAtom } from "jotai";
import { useCallback } from "react";
import { cursorStyleAtom } from "../store/atoms";
import { type CursorStyle, setStoredCursorStyle } from "../theme/cursor";

export function useCursorStyle() {
	const [style, setStyleAtom] = useAtom(cursorStyleAtom);

	const setStyle = useCallback(
		(value: CursorStyle) => {
			setStoredCursorStyle(value);
			setStyleAtom(value);
		},
		[setStyleAtom],
	);

	return { style, setStyle };
}

/** @deprecated 使用 useCursorStyle */
export const useCustomCursor = useCursorStyle;
