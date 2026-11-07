import { useAtom } from "jotai";
import { useCallback } from "react";
import { uiFontAtom } from "../store/atoms";
import { setStoredUiFont, type UiFontFamily } from "../theme/ui-font";

export function useUiFont() {
	const [family, setFamilyAtom] = useAtom(uiFontAtom);

	const setFamily = useCallback(
		(value: UiFontFamily) => {
			setStoredUiFont(value);
			setFamilyAtom(value);
		},
		[setFamilyAtom],
	);

	return { family, setFamily };
}
