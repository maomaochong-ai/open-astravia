import { useAtom } from "jotai";
import { useCallback } from "react";
import { sidebarStyleAtom } from "../store/atoms";
import { type SidebarStyle, setStoredSidebarStyle } from "../theme/sidebar-style";

export function useSidebarStyle() {
	const [style, setStyleAtom] = useAtom(sidebarStyleAtom);

	const setStyle = useCallback(
		(value: SidebarStyle) => {
			setStoredSidebarStyle(value);
			setStyleAtom(value);
		},
		[setStyleAtom],
	);

	return { style, setStyle };
}
