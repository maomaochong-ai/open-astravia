import { pageHeaderTitleHiddenAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useOwnedHeaderSlot } from "./useOwnedHeaderSlot";

/** 当前 surface 在前台时隐藏顶栏路由标题；切走后恢复，避免后台页撤稿把下一页标题闪出来。 */
export function useOwnedHeaderTitleHidden(active: boolean): void {
	const setHidden = useSetAtom(pageHeaderTitleHiddenAtom);
	useOwnedHeaderSlot(active, true, (next) => {
		setHidden(next === true);
	});
}
