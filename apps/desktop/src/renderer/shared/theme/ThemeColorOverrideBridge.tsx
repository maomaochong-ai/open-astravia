import { useLayoutEffect, useRef } from "react";
import { useThemeAppearance } from "@vetta/theme-sdk/appearance";
import { useTheme } from "../hooks/useTheme";
import { applyStoredTheme, setThemeColorOverrides } from "./apply";

/**
 * 将当前 UI 主题的 appearance.colors / colorScheme 同步到 document。
 * colorScheme 存在时，复用设置页同一套 setMode 切到对应亮/暗模式。
 */
export function ThemeColorOverrideBridge(): null {
	const appearance = useThemeAppearance();
	const { setMode } = useTheme();
	// 只在 colorScheme 变化时切一次，避免 colors 重渲染时覆盖用户手动改的模式。
	const lastForcedSchemeRef = useRef<"light" | "dark" | null>(null);

	useLayoutEffect(() => {
		const root = document.documentElement;
		const previousColorScheme = root.style.colorScheme;

		setThemeColorOverrides(appearance.colors);
		if (appearance.colorScheme) {
			root.style.colorScheme = appearance.colorScheme;
		}
		applyStoredTheme();

		const scheme = appearance.colorScheme;
		if (scheme === "light" || scheme === "dark") {
			if (lastForcedSchemeRef.current !== scheme) {
				lastForcedSchemeRef.current = scheme;
				void setMode(scheme);
			}
		} else {
			lastForcedSchemeRef.current = null;
		}

		return () => {
			setThemeColorOverrides();
			root.style.colorScheme = previousColorScheme;
			applyStoredTheme();
		};
	}, [appearance.colorScheme, appearance.colors, setMode]);

	return null;
}
