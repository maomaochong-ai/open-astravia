import { createContext, useContext } from "react";
import type { BottomPanelHandle } from "./types";

const BottomPanelInstanceContext = createContext<BottomPanelHandle | null>(null);

export const BottomPanelInstanceProvider = BottomPanelInstanceContext.Provider;

/**
 * 面板内容组件取自己的实例身份与控制面。
 * 在面板之外调用是接线错误，所以直接抛而不是返回 null——否则错误会以「改名没生效」
 * 这种难查的形式出现。
 */
export function useBottomPanelInstance(): BottomPanelHandle {
	const handle = useContext(BottomPanelInstanceContext);
	if (!handle) throw new Error("useBottomPanelInstance must be called inside a bottom panel tab");
	return handle;
}
