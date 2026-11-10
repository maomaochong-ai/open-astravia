import { useAtom } from "jotai";
import { useCallback } from "react";
import { fontAtom } from "../store/ui-atoms";
import { setStoredFont, type UiFontFamily } from "../theme/ui-font";

/** 全局字体：一个档位，一次写入同时更新界面与代码两侧的令牌。 */
export function useUiFont() {
	const [family, setFamilyAtom] = useAtom(fontAtom);

	const setFamily = useCallback(
		(value: UiFontFamily) => {
			setStoredFont(value);
			setFamilyAtom(value);
		},
		[setFamilyAtom],
	);

	return { family, setFamily };
}
