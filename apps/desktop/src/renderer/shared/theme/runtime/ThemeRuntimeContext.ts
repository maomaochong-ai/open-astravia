import { createContext, useContext } from "react";
import type { ThemeRuntimeValue } from "./types";

/**
 * context 与 hook 独立成模块：ThemeRuntimeProvider.tsx 只导出组件，才能成为
 * Fast Refresh 边界。否则 HMR 会让消费方拿到新模块的 context，而已挂载的
 * Provider 仍用旧 context，useContext 取到 null。
 */
export const ThemeRuntimeContext = createContext<ThemeRuntimeValue | null>(null);

export function useThemeRuntime(): ThemeRuntimeValue {
	const value = useContext(ThemeRuntimeContext);
	if (!value) throw new Error("useThemeRuntime must be used within ThemeRuntimeProvider");
	return value;
}
