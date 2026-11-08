import { useAtom } from "jotai";
import { useCallback } from "react";
import { codeFontAtom, uiFontAtom } from "../store/atoms";
import { setStoredCodeFont, setStoredUiFont, type UiFontFamily } from "../theme/ui-font";

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

/** 两个字体位置各自的当前值与写入动作，供外观设置页使用。 */
export function useFontRoles() {
	const { family: ui, setFamily: setUi } = useUiFont();
	const [code, setCodeAtom] = useAtom(codeFontAtom);

	const setCode = useCallback(
		(value: UiFontFamily) => {
			setStoredCodeFont(value);
			setCodeAtom(value);
		},
		[setCodeAtom],
	);

	return { ui, setUi, code, setCode };
}
